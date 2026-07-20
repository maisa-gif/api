"use client";

import Link from "next/link";
import { useState } from "react";
import type { GoogleCalendarConnection } from "@/lib/integrations/google-calendar/connection";

function formatDateTime(value: string | Date | null): string {
  if (!value) return "nunca";
  return new Date(value).toLocaleString("pt-BR");
}

export function GoogleCalendarCard({
  initial,
  bannerStatus,
}: {
  initial: GoogleCalendarConnection & { hasEnvCredentials: boolean };
  bannerStatus?: "connected" | "error";
}) {
  const [connection, setConnection] = useState(initial);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    setError(null);
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/google-calendar/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Falha ao desconectar");
      setConnection({ ...connection, connected: false, enabled: false, email: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao desconectar");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
      <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        Conecte seu Google Agenda para receber automaticamente os agendamentos da agenda do Clínica
        nas Nuvens como eventos do Google Calendar.
      </p>

      {bannerStatus === "connected" && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Google Agenda conectado com sucesso.
        </p>
      )}
      {bannerStatus === "error" && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Não foi possível conectar ao Google Agenda. Tente novamente.
        </p>
      )}

      {!connection.hasEnvCredentials && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e APP_URL ainda não foram configurados no
          ambiente.
        </p>
      )}

      <div className="mt-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Status</p>
          <p className="mt-1 text-sm text-zinc-400">
            {connection.connected ? `Conectado${connection.email ? ` (${connection.email})` : ""}` : "Não conectado"}
          </p>
        </div>
        {connection.connected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="shrink-0 rounded-lg bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            Desconectar
          </button>
        ) : (
          <Link
            href="/api/integrations/google-calendar/connect"
            aria-disabled={!connection.hasEnvCredentials}
            className={`shrink-0 rounded-lg px-4 py-3 text-sm font-medium text-white ${
              connection.hasEnvCredentials
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "pointer-events-none bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            Conectar com Google
          </Link>
        )}
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Última sincronização</p>
        <p className="mt-1 text-sm text-zinc-400">{formatDateTime(connection.lastSyncAt)}</p>
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
    </div>
  );
}
