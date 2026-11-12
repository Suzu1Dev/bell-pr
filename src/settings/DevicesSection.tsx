import { useEffect, useState } from "react";
import { api, currentApiToken, deviceInfoStorageKey, deviceTokenStorageKey, send } from "../api";
import { useFormat, useT } from "../i18n";
import { Feedback, messageOf, SettingsGroup } from "./controls";

export interface PairedDevice {
  id: string;
  name: string;
  createdAt?: string;
  lastUsedAt: string | null;
  current?: boolean;
}

export function DevicesSection() {
  const t = useT("settings");
  const d = t.general.devices;
  const format = useFormat();
  const [deviceToken] = useState(() => currentApiToken()?.startsWith("bpd_") === true);
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<PairedDevice[]>("/devices", { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setDevices(value); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(messageOf(failure)); });
    return () => controller.abort();
  }, [attempt]);
  const revoke = async (device: PairedDevice) => {
    setBusy(true);
    setError("");
    try {
      await api(`/devices/${encodeURIComponent(device.id)}`, send("DELETE"));
      let storedId: unknown;
      try { storedId = JSON.parse(localStorage.getItem(deviceInfoStorageKey) ?? "null")?.id; }
      catch { /* Saved metadata is optional; the API current flag is authoritative. */ }
      if (device.current || device.id === storedId) {
        localStorage.removeItem(deviceTokenStorageKey);
        localStorage.removeItem(deviceInfoStorageKey);
        window.location.replace("/pair");
      } else setDevices((items) => items?.filter((item) => item.id !== device.id) ?? []);
    } catch (failure) { setError(messageOf(failure)); }
    finally { setBusy(false); }
  };
  return <SettingsGroup title={d.title} text={d.text}>
    <p>{d.access}</p>
    <Feedback error={error} message={!devices && !error ? t.state.loading : ""} />
    {error && <button className="button secondary" disabled={busy} onClick={() => { setError(""); setAttempt((value) => value + 1); }}>{t.state.retry}</button>}
    {devices?.length === 0 && <p role="status">{d.empty}</p>}
    <ul>{devices?.map((device) => <li key={device.id} className="settings-field">
      <strong>{device.name}</strong> {device.current && <span>{d.current}</span>}
      <p>{d.created}: {device.createdAt ? format.dateTime(device.createdAt) : d.unknown}</p>
      <p>{d.lastUsed}: {device.lastUsedAt ? format.dateTime(device.lastUsedAt) : deviceToken ? d.unknown : d.never}</p>
      <button className="button secondary" disabled={busy} onClick={() => void revoke(device)}>{d.revoke}</button>
    </li>)}</ul>
  </SettingsGroup>;
}
