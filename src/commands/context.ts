import type * as vscode from 'vscode';
import type { ForwardManager } from '../forward/forwardManager';
import type { HostService } from '../hosts/hostService';
import type { HostResolver, PromptSession } from '../ssh/types';
import type { SessionRegistry } from '../session/sessionRegistry';
import type { ForwardRepository } from '../storage/forwardRepository';
import type { HostRepository } from '../storage/hostRepository';
import type { HostTreeProvider } from '../views/hostTree/hostTreeProvider';

/** Services the command handlers depend on. */
export interface CommandContext {
  extensionUri: vscode.Uri;
  output: vscode.OutputChannel;
  hosts: HostRepository;
  forwards: ForwardRepository;
  hostService: HostService;
  resolver: HostResolver;
  newPromptSession: () => PromptSession;
  forwardManager: ForwardManager;
  sessions: SessionRegistry;
  tree: HostTreeProvider;
}
