import { SettingsViewPage } from '../settings-view';

interface ConfigViewProps {
  sendRaw: (data: Record<string, unknown>) => void;
}

// Reuse existing SettingsViewPage for the dashboard config view
export function ConfigView({ sendRaw }: ConfigViewProps) {
  return <SettingsViewPage sendRaw={sendRaw} />;
}
