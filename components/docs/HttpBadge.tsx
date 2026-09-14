import { cn } from "@/lib/utils";

type Tone = "green" | "blue" | "amber" | "red" | "violet" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  green: "border-[color:var(--tone-green-line)] bg-[color:var(--tone-green-soft)] text-[color:var(--tone-green)]",
  blue: "border-[color:var(--tone-blue-line)] bg-[color:var(--tone-blue-soft)] text-[color:var(--tone-blue)]",
  amber: "border-[color:var(--tone-amber-line)] bg-[color:var(--tone-amber-soft)] text-[color:var(--tone-amber)]",
  red: "border-[color:var(--tone-red-line)] bg-[color:var(--tone-red-soft)] text-[color:var(--tone-red)]",
  violet: "border-[color:var(--tone-violet-line)] bg-[color:var(--tone-violet-soft)] text-[color:var(--tone-violet)]",
  neutral: "border-ruleStrong bg-raised text-inkMuted",
};

const METHOD_TONE: Record<string, Tone> = {
  GET: "blue",
  POST: "green",
  PUT: "amber",
  PATCH: "amber",
  DELETE: "red",
  DEL: "red",
  WS: "violet",
};

export const HTTP_METHODS = new Set(Object.keys(METHOD_TONE));

const STATUS_TEXT: Record<number, string> = {
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  410: "Gone",
  412: "Precondition Failed",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** Colour by class, the way people read status codes: success, redirect, client error, server error. */
function statusTone(code: number): Tone {
  if (code >= 500) return "red";
  if (code >= 400) return "amber";
  if (code >= 300) return "blue";
  if (code >= 200) return "green";
  return "violet";
}

const BASE =
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-px font-mono text-micro font-semibold";

export function MethodBadge({ method, neutral = false }: { method: string; neutral?: boolean }) {
  const tone = neutral ? "neutral" : (METHOD_TONE[method] ?? "neutral");
  return (
    <span className={cn(BASE, "min-w-[3.75rem] justify-center", TONE_CLASS[tone])}>
      {method === "DEL" && !neutral ? "DELETE" : method}
    </span>
  );
}

export function StatusBadge({ code, withText = true }: { code: number; withText?: boolean }) {
  const text = STATUS_TEXT[code];
  return (
    <span title={text ? `${code} ${text}` : String(code)} className={cn(BASE, TONE_CLASS[statusTone(code)])}>
      {code}
      {withText && text && <span className="font-normal">{text}</span>}
    </span>
  );
}
