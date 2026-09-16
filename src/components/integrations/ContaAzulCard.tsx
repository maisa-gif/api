"use client";

import Link from "next/link";
import { useState } from "react";
import type { ContaAzulConnection } from "@/lib/integrations/conta-azul/connection";

function formatDateTime(value: string | Date | null): string {
  if (!value) return "nunca";
  return new Date(value).toLocaleString("pt-BR");
}

export function ContaAzulCard({
  initial,
  bannerStatus,
}: {
  initial: ContaAzulConnection & { hasEnvCredentials: boolean };
  bannerStatus?: "connected" | "error";
}) {
  const [connection, setConnection] = useState(initial);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    setError(null);
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/conta-azul/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Falha ao desconectar");
      setConnection({ ...connection, connected: false, enabled: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao desconectar");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
      <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        Conecte a Conta Azul para trazer o que foi pago e recebido no dia para o relatório diário.
      </p>

      {bannerStatus === "connected" && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Conta Azul conectada com sucesso.
        </p>
      )}
      {bannerStatus === "error" && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Não foi possível conectar à Conta Azul. Tente novamente.
        </p>
      )}

      {!connection.hasEnvCredentials && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          CONTA_AZUL_CLIENT_ID, CONTA_AZUL_CLIENT_SECRET e APP_URL ainda não foram configurados no
          ambiente.
        </p>
      )}

      <div className="mt-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Status</p>
          <p className="mt-1 text-sm text-zinc-400">{connection.connected ? "Conectado" : "Não conectado"}</p>
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
            href="/api/integrations/conta-azul/connect"
            aria-disabled={!connection.hasEnvCredentials}
            className={`shrink-0 rounded-lg px-4 py-3 text-sm font-medium text-white ${
              connection.hasEnvCredentials
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "pointer-events-none bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            Conectar com Conta Azul
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
