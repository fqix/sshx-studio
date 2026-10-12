import { t } from '../../i18n';
import { IconButton } from '../common/IconButton';

interface Props {
  canDownload: boolean;
  onUp(): void;
  onHome(): void;
  onRefresh(): void;
  onCdHere(): void;
  onMkdir(): void;
  onUpload(): void;
  onUploadFolder(): void;
  onDownload(): void;
}

export function Toolbar(p: Props) {
  return (
    <div className="fb-toolbar" role="toolbar">
      <IconButton icon="arrow-up" label={t('files.up')} onClick={p.onUp} />
      <IconButton icon="home" label={t('files.home')} onClick={p.onHome} />
      <IconButton icon="refresh" label={t('files.refresh')} onClick={p.onRefresh} />
      <IconButton icon="terminal" label={t('files.cdHere')} onClick={p.onCdHere} />
      <span className="spacer" />
      <IconButton icon="new-folder" label={t('files.newFolder')} onClick={p.onMkdir} />
      <IconButton icon="cloud-upload" label={t('files.upload')} onClick={p.onUpload} />
      <IconButton icon="folder-opened" label={t('files.uploadFolder')} onClick={p.onUploadFolder} />
      <IconButton icon="cloud-download" label={t('files.download')} onClick={p.onDownload} disabled={!p.canDownload} />
    </div>
  );
}
