import { createConnection } from "node:net";

export function redisCommand(host: string, port: number, ...parts: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const command = `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
    let received = Buffer.alloc(0);
    socket.setTimeout(5_000);
    socket.once("connect", () => socket.write(command));
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const lineEnd = received.indexOf("\r\n");
      if (lineEnd < 0) return;
      const header = received.subarray(0, lineEnd).toString();
      if (header.startsWith("-")) return finish(new Error(header.slice(1)));
      if (header.startsWith("+")) return finish(null, header.slice(1));
      if (header === "$-1") return finish(null, null);
      if (!header.startsWith("$")) return finish(new Error("invalid Redis response"));
      const length = Number(header.slice(1));
      if (!Number.isInteger(length) || length < 0) return finish(new Error("invalid Redis bulk length"));
      if (received.length >= lineEnd + 2 + length + 2) {
        return finish(null, received.subarray(lineEnd + 2, lineEnd + 2 + length).toString());
      }
    });
    socket.once("error", reject);
    socket.once("timeout", () => finish(new Error("Redis timeout")));
    function finish(error: Error | null, value?: string | null) {
      socket.destroy();
      if (error) reject(error);
      else resolve(value ?? null);
    }
  });
}
