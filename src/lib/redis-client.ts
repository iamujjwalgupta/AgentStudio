import net from "net";
import tls from "tls";

export type RedisConfig = {
  host?: string;
  port?: number | string;
  tls?: boolean;
};

/**
 * Encodes an array of command arguments into the Redis RESP wire format.
 */
function encodeCommand(args: string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const s = String(arg);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return out;
}

/**
 * Parses a simple RESP response buffer.
 */
function parseResp(data: Buffer): { result: any; error?: Error } {
  const str = data.toString("utf8");
  if (!str.length) return { result: null };

  const prefix = str[0];
  const body = str.slice(1);

  if (prefix === "+") {
    // Simple string (e.g. +OK, +PONG)
    return { result: body.split("\r\n")[0] };
  }
  if (prefix === "-") {
    // Error string
    return { result: null, error: new Error(body.split("\r\n")[0]) };
  }
  if (prefix === ":") {
    // Integer
    return { result: parseInt(body.split("\r\n")[0], 10) };
  }
  if (prefix === "$") {
    // Bulk string
    const firstCrlf = str.indexOf("\r\n");
    const len = parseInt(str.slice(1, firstCrlf), 10);
    if (len === -1) return { result: null };
    const content = str.slice(firstCrlf + 2, firstCrlf + 2 + len);
    return { result: content };
  }

  // Fallback trimmed
  return { result: str.trim() };
}

/**
 * Executes one or more commands sequentially over a single socket connection.
 */
export async function executeRedis(
  config: RedisConfig,
  password: string | undefined,
  commandArgs: string[]
): Promise<any> {
  const host = config.host?.trim() || "localhost";
  const port = Number(config.port) || 6379;
  const useTls = Boolean(config.tls || port === 6380);

  return new Promise((resolve, reject) => {
    let resolved = false;
    let buffer = Buffer.alloc(0);

    const socket = useTls
      ? tls.connect({ host, port, rejectUnauthorized: false })
      : net.connect({ host, port });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`Redis connection timed out after 6000ms (${host}:${port})`));
      }
    }, 6000);

    const cleanup = () => {
      clearTimeout(timeout);
      if (!socket.destroyed) socket.end();
    };

    socket.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    });

    socket.on("connect", () => {
      if (password && password.trim()) {
        socket.write(encodeCommand(["AUTH", password.trim()]));
      } else {
        socket.write(encodeCommand(commandArgs));
      }
    });

    let authDone = !password || !password.trim();

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!authDone) {
        // Parse auth response first
        const parsed = parseResp(buffer);
        if (parsed.error) {
          resolved = true;
          cleanup();
          return reject(parsed.error);
        }
        if (parsed.result !== undefined && parsed.result !== null) {
          authDone = true;
          buffer = Buffer.alloc(0);
          socket.write(encodeCommand(commandArgs));
          return;
        }
      }

      // Parse actual command response
      if (authDone && buffer.length > 0) {
        const parsed = parseResp(buffer);
        if (parsed.error) {
          resolved = true;
          cleanup();
          return reject(parsed.error);
        }
        resolved = true;
        cleanup();
        return resolve(parsed.result);
      }
    });
  });
}

/**
 * Pings Redis server to verify connectivity and credentials.
 */
export async function testRedisConnection(
  config: RedisConfig,
  password?: string
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await executeRedis(config, password, ["PING"]);
    if (res === "PONG") {
      return { ok: true, detail: `Connected to Redis at ${config.host || "localhost"}:${config.port || 6379} (PONG)` };
    }
    return { ok: true, detail: `Redis responded: ${res}` };
  } catch (err: any) {
    return { ok: false, detail: err?.message || String(err) };
  }
}
