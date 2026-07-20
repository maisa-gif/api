"use client";

import { useState } from "react";
import type { IntegrationStatus } from "@/lib/integrations/service";

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 4.24A11 11 0 0 1 12 4c7 0 11 7 11 7a13.2 13.2 0 0 1-3.1 3.9M6.6 6.6C3.7 8.4 1 12 1 12s4 7 11 7a10.6 10.6 0 0 0 3.9-.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-14 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-emerald-400" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-zinc-900 transition-transform ${
          checked ? "translate-x-8" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function IntegrationCard({ initial }: { initial: IntegrationStatus }) {
  const [status, setStatus] = useState(initial);
  const [savingToggle, setSavingToggle] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: { enabled?: boolean; token?: string }) {
    const res = await fetch(`/api/integrations/${status.type}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(data.error ?? "Request failed");
    }
    return (await res.json()) as IntegrationStatus;
  }

  async function handleToggle(next: boolean) {
    setError(null);
    setSavingToggle(true);
    try {
      setStatus(await patch({ enabled: next }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSavingToggle(false);
    }
  }

  async function handleSaveToken() {
    if (!tokenDraft.trim()) return;
    setError(null);
    setSavingToken(true);
    try {
      setStatus(await patch({ token: tokenDraft.trim() }));
      setEditingToken(false);
      setTokenDraft("");
      setTokenVisible(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update token");
    } finally {
      setSavingToken(false);
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
      <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {status.description}{" "}
        <a
          href={status.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-600 underline dark:text-emerald-400"
        >
          {status.docsUrl}
        </a>
        .
      </p>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Ativar serviço?</span>
        <Toggle checked={status.enabled} disabled={savingToggle} onChange={handleToggle} />
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{status.clientIdLabel}</p>
        <p className="mt-1 text-sm text-zinc-400">{status.clientId ?? "não configurado"}</p>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{status.clientSecretLabel}</p>
        <p className="mt-1 truncate text-sm text-zinc-400">{status.clientSecret ?? "não configurado"}</p>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{status.tokenLabel}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex flex-1 items-center justify-between rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
            <span className="truncate text-sm text-zinc-400">
              {status.token
                ? tokenVisible
                  ? status.token
                  : "•".repeat(Math.min(status.token.length, 32))
                : "não configurado"}
            </span>
            {status.token && (
              <button
                type="button"
                onClick={() => setTokenVisible((v) => !v)}
                aria-label={tokenVisible ? "Ocultar token" : "Mostrar token"}
                className="ml-3 shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <EyeIcon open={!tokenVisible} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingToken((v) => !v);
              setTokenDraft("");
            }}
            className="shrink-0 rounded-lg bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            Alterar token
          </button>
        </div>

        {editingToken && (
          <div className="mt-3 flex items-center gap-3">
            <input
              type="text"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="Novo token/hash"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={handleSaveToken}
              disabled={savingToken || !tokenDraft.trim()}
              className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={() => setEditingToken(false)}
              className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
    </div>
  );
}
