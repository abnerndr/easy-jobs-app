"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  provider: "linkedin" | "indeed";
  sessionId: string;
  viewport: { width: number; height: number };
  onConnected: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

async function sendInput(
  provider: string,
  sessionId: string,
  event: Record<string, unknown>
) {
  const response = await fetch(`/api/connections/${provider}/remote/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, event }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? "Falha ao interagir com o navegador.");
  }
  return body as { status: string; error?: string | null };
}

export function RemoteLoginViewer({
  provider,
  sessionId,
  viewport,
  onConnected,
  onCancel,
  onError,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameUrl, setFrameUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshFrame = useEffectEvent(() => {
    setFrameUrl(
      `/api/connections/${provider}/remote/frame?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}`
    );
  });

  const pollStatus = useEffectEvent(async () => {
    try {
      const response = await fetch(
        `/api/connections/${provider}/remote?sessionId=${encodeURIComponent(sessionId)}`
      );
      const body = await response.json();
      if (!response.ok) {
        onError(body?.error ?? "Sessão expirada.");
        return;
      }
      if (body.status === "connected") {
        onConnected();
        return;
      }
      if (body.status === "failed" || body.status === "expired") {
        onError(body.error ?? "Login não concluído.");
      }
    } catch {
      onError("Falha ao verificar status do login.");
    }
  });

  useEffect(() => {
    refreshFrame();
    const frameTimer = setInterval(refreshFrame, 700);
    const statusTimer = setInterval(() => {
      void pollStatus();
    }, 1500);
    return () => {
      clearInterval(frameTimer);
      clearInterval(statusTimer);
    };
  }, [sessionId, provider]);

  useEffect(() => {
    containerRef.current?.focus();
  }, [sessionId]);

  function mapPoint(clientX: number, clientY: number) {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * viewport.width;
    const y = ((clientY - rect.top) / rect.height) * viewport.height;
    return { x, y };
  }

  async function handlePointer(event: MouseEvent<HTMLImageElement>) {
    const point = mapPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    containerRef.current?.focus();
    setBusy(true);
    try {
      const result = await sendInput(provider, sessionId, {
        type: event.detail > 1 ? "dblclick" : "click",
        x: point.x,
        y: point.y,
      });
      refreshFrame();
      if (result.status === "connected") onConnected();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Erro no clique.");
    } finally {
      setBusy(false);
    }
  }

  async function handleWheel(event: WheelEvent<HTMLImageElement>) {
    event.preventDefault();
    try {
      await sendInput(provider, sessionId, {
        type: "wheel",
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      refreshFrame();
    } catch {
      // ignore wheel errors
    }
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    setBusy(true);
    try {
      const special = [
        "Enter",
        "Tab",
        "Backspace",
        "Delete",
        "Escape",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
      ];
      if (special.includes(event.key)) {
        await sendInput(provider, sessionId, { type: "key", key: event.key });
      } else if (event.key.length === 1) {
        await sendInput(provider, sessionId, { type: "type", text: event.key });
      }
      refreshFrame();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Erro no teclado.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    await fetch(
      `/api/connections/${provider}/remote?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    );
    onCancel();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Clique na imagem e digite como em um Chrome normal. A sessão é salva
        automaticamente após o login.
      </p>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="border-input bg-muted/30 focus-visible:ring-ring overflow-hidden rounded-xl border outline-none focus-visible:ring-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={frameUrl}
          alt={`Login ${provider}`}
          className="block h-auto w-full cursor-crosshair select-none"
          draggable={false}
          onClick={handlePointer}
          onWheel={handleWheel}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancelar
        </Button>
        {busy ? <Spinner className="size-4" /> : null}
      </div>
    </div>
  );
}
