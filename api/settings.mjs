import { loadSettings } from '../settings.mjs';
import { shell, setPageHeaders } from '../ui.mjs';
import { settingsBody } from '../panel.mjs';

export default async function handler(req, res) {
  const settings = await loadSettings();
  const body =
    `<div class="pagehead"><h1>Settings</h1><p>Choose what happens when a product sells out.</p></div>` +
    settingsBody(settings);
  setPageHeaders(res);
  res.end(shell({ title: 'Settings', active: 'settings', body }));
}
