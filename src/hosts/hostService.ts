import * as fs from 'fs';
import type { HostDraft, HostDraftField, HostEditorState } from '../../shared/protocol';
import type { ResolvedHost } from '../config/types';
import { resolveRecord } from '../storage/hostResolver';
import { expandHome } from '../config/tokens';
import { t } from '../i18n';
import { inspectPrivateKey, KeyPair } from '../ssh/keygen';
import { groupPaths, type GroupRepository } from '../storage/groupRepository';
import type { HostRepository } from '../storage/hostRepository';
import type { HostSecretStore } from '../storage/secretStore';
import type { HostRecord } from '../storage/types';

export type GeneratedKey = KeyPair & { passphrase: string };

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field?: HostDraftField,
  ) {
    super(message);
  }
}

/** Host create/update/delete: validation, database rows and keychain secrets together. */
export class HostService {
  constructor(
    private readonly hosts: HostRepository,
    private readonly secrets: HostSecretStore,
    private readonly groups: GroupRepository,
  ) {}

  /** `newGroupId` is the group a new host starts in. */
  async editorState(id?: number, newGroupId?: number): Promise<HostEditorState> {
    const record = id === undefined ? undefined : await this.hosts.findById(id);
    const otherAliases = (await this.hosts.list()).filter((h) => h.id !== id).map((h) => h.alias);
    const paths = groupPaths(await this.groups.list());
    const groups = [...paths].map(([gid, path]) => ({ id: gid, path })).sort((a, b) => a.path.localeCompare(b.path));
    if (!record) {
      const groupId = newGroupId !== undefined && paths.has(newGroupId) ? newGroupId : null;
      return { draft: { ...emptyDraft(), groupId }, saved: { password: false, privateKey: false, passphrase: false }, publicKey: '', otherAliases, groups };
    }
    const s = await this.secrets.load(record.id);
    return {
      draft: {
        ...emptyDraft(),
        ...pick(record),
        forwardAgent: isEnabled(record.options['forwardagent']),
        forwardX11: isEnabled(record.options['forwardx11']),
      },
      saved: { password: !!s.password, privateKey: !!s.privateKey, passphrase: !!s.passphrase },
      publicKey: record.publicKey,
      otherAliases,
      groups,
    };
  }

  /** Validate and persist. `generated` is a key pair created in the editor but not saved yet. */
  async save(draft: HostDraft, generated?: GeneratedKey): Promise<HostRecord> {
    const { existing, row, secretChanges } = await this.prepare(draft, generated, 'save');
    const record = existing ? await this.hosts.update(existing.id, row) : await this.hosts.insert({ ...row, source: 'manual' });
    await this.secrets.save(record.id, secretChanges);
    return record;
  }

  /**
   * The host exactly as the form describes it — unsaved passwords, pasted or generated keys
   * included — for "Test connection". Nothing is written.
   */
  async previewHost(draft: HostDraft, generated?: GeneratedKey): Promise<ResolvedHost> {
    const { d, existing, row, effectiveSecrets } = await this.prepare(draft, generated, 'test');
    const now = Date.now();
    const record: HostRecord = { ...row, alias: d.alias || d.hostname, id: existing?.id ?? 0, source: existing?.source ?? 'manual', createdAt: now, updatedAt: now };
    return { ...resolveRecord(record, effectiveSecrets), id: existing?.id };
  }

  /** Shared by save and test: validate the draft and work out the row and secrets it implies. */
  private async prepare(draft: HostDraft, generated: GeneratedKey | undefined, mode: 'save' | 'test') {
    const d = normalize(draft);
    await this.validateBasics(d, mode);
    const existingSecrets = d.id === undefined ? {} : await this.secrets.load(d.id);
    const existing = d.id === undefined ? undefined : await this.hosts.findById(d.id);

    // Resolve the private key / public key for keyStored. null = delete, undefined = keep.
    let privateKey: string | null | undefined;
    let passphrase: string | null | undefined = d.clearPassphrase ? null : d.passphrase || undefined;
    let publicKey = existing?.publicKey ?? '';
    if (d.authMethod === 'keyStored') {
      if (generated) {
        privateKey = generated.privateKey;
        publicKey = generated.publicKey;
        passphrase = generated.passphrase || null;
      } else if (d.privateKey) {
        const check = inspectPrivateKey(d.privateKey, d.passphrase || (d.clearPassphrase ? undefined : existingSecrets.passphrase), d.alias);
        if (!check.ok) {
          if (check.reason === 'invalid') throw new ValidationError(t('Not a valid private key: {0}', check.message), 'privateKey');
          throw new ValidationError(check.reason === 'needsPassphrase' ? t('This key is encrypted; enter its passphrase.') : t('Wrong passphrase.'), 'passphrase');
        }
        privateKey = d.privateKey;
        publicKey = check.publicKey;
      } else if (!existingSecrets.privateKey) {
        throw new ValidationError(t('Paste a private key or generate a new one.'), 'privateKey');
      }
    } else {
      // Leaving keyStored drops the stored key.
      privateKey = existingSecrets.privateKey ? null : undefined;
      publicKey = '';
      if (d.authMethod !== 'keyFile') passphrase = existingSecrets.passphrase ? null : undefined;
    }
    const password = d.clearPassword ? null : d.password || undefined;

    const row = {
      alias: d.alias,
      hostname: d.hostname,
      port: d.port,
      username: d.username,
      authMethod: d.authMethod,
      identityFile: d.authMethod === 'keyFile' || d.authMethod === 'auto' ? d.identityFile : '',
      publicKey,
      proxyJump: d.proxyJump,
      proxyCommand: d.proxyCommand,
      groupId: d.groupId,
      options: withFlags(existing?.options ?? {}, { forwardagent: d.forwardAgent, forwardx11: d.forwardX11 }),
    };
    const effective = <T>(change: T | null | undefined, saved: T | undefined) => (change === null ? undefined : change ?? saved);
    return {
      d,
      existing,
      row,
      secretChanges: { password, privateKey, passphrase },
      effectiveSecrets: {
        password: effective(password, existingSecrets.password),
        privateKey: effective(privateKey, existingSecrets.privateKey),
        passphrase: effective(passphrase, existingSecrets.passphrase),
      },
    };
  }

  async delete(id: number) {
    await this.hosts.delete(id);
    await this.secrets.clear(id);
  }

  async publicKey(id: number): Promise<string | undefined> {
    return (await this.hosts.findById(id))?.publicKey || undefined;
  }

  /** Testing a connection doesn't need a (unique) name — nothing is saved. */
  private async validateBasics(d: HostDraft, mode: 'save' | 'test') {
    if (mode === 'save') {
      if (!d.alias) throw new ValidationError(t('Name is required.'), 'alias');
      if (/\s/.test(d.alias)) throw new ValidationError(t('Name cannot contain spaces.'), 'alias');
      const clash = await this.hosts.findByAlias(d.alias);
      if (clash && clash.id !== d.id) throw new ValidationError(t('A host named "{0}" already exists.', d.alias), 'alias');
    }
    if (!d.hostname) throw new ValidationError(t('Host is required.'), 'hostname');
    if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535) throw new ValidationError(t('Port must be between 1 and 65535.'), 'port');
    if (d.authMethod === 'keyFile') {
      if (!d.identityFile) throw new ValidationError(t('Choose a private key file.'), 'identityFile');
      if (!fs.existsSync(expandHome(d.identityFile))) throw new ValidationError(t('File not found: {0}', d.identityFile), 'identityFile');
    }
    if (d.proxyJump && d.proxyCommand) throw new ValidationError(t('Use either ProxyJump or ProxyCommand, not both.'), 'proxyJump');
    if (mode === 'save' && d.groupId !== null && !(await this.groups.findById(d.groupId))) {
      throw new ValidationError(t('That group no longer exists.'), 'groupId');
    }
  }
}

export function emptyDraft(): HostDraft {
  return {
    alias: '',
    hostname: '',
    port: 22,
    username: '',
    authMethod: 'auto',
    identityFile: '',
    proxyJump: '',
    proxyCommand: '',
    groupId: null,
    password: '',
    clearPassword: false,
    privateKey: '',
    passphrase: '',
    clearPassphrase: false,
    forwardAgent: false,
    forwardX11: false,
  };
}

/** ssh_config yes/no option (ForwardAgent may also hold an agent path, which counts as on). */
const isEnabled = (v: string | undefined) => !!v && v.toLowerCase() !== 'no';

/** Set yes/no options, keeping a custom ForwardAgent path if it was already enabled. */
function withFlags(options: Record<string, string>, flags: Record<string, boolean>): Record<string, string> {
  const out = { ...options };
  for (const [key, on] of Object.entries(flags)) {
    if (!on) delete out[key];
    else if (!isEnabled(out[key])) out[key] = 'yes';
  }
  return out;
}

function pick(r: HostRecord): Partial<HostDraft> {
  return {
    id: r.id,
    alias: r.alias,
    hostname: r.hostname,
    port: r.port,
    username: r.username,
    authMethod: r.authMethod,
    identityFile: r.identityFile,
    proxyJump: r.proxyJump,
    proxyCommand: r.proxyCommand,
    groupId: r.groupId,
  };
}

function normalize(d: HostDraft): HostDraft {
  const trim = (s: string) => (s ?? '').trim();
  return {
    ...d,
    alias: trim(d.alias),
    hostname: trim(d.hostname),
    port: Number(d.port),
    username: trim(d.username),
    identityFile: trim(d.identityFile),
    proxyJump: trim(d.proxyJump),
    proxyCommand: trim(d.proxyCommand),
    groupId: d.groupId ?? null,
    privateKey: trim(d.privateKey) ? trim(d.privateKey) + '\n' : '',
  };
}
