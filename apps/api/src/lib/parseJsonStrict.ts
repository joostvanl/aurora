/** Thrown when JSON is invalid or contains duplicate object keys. */
export class JsonStrictParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonStrictParseError";
  }
}

/**
 * JSON parser that rejects duplicate keys during parse.
 * Do not use `JSON.parse` + reviver — the second key is already lost.
 */
export function parseJsonStrict(source: string): unknown {
  const p = new JsonStrictParser(source);
  const value = p.parseValue();
  p.skipWs();
  if (!p.eof()) {
    throw new JsonStrictParseError(
      `Unexpected trailing data at position ${p.pos}`,
    );
  }
  return value;
}

class JsonStrictParser {
  readonly source: string;
  pos = 0;

  constructor(source: string) {
    this.source = source;
  }

  eof(): boolean {
    return this.pos >= this.source.length;
  }

  peek(): string {
    return this.source[this.pos] ?? "";
  }

  skipWs(): void {
    const s = this.source;
    let i = this.pos;
    while (i < s.length) {
      const c = s[i]!;
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i += 1;
      else break;
    }
    this.pos = i;
  }

  parseValue(): unknown {
    this.skipWs();
    const c = this.peek();
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"') return this.parseString();
    if (c === "t") return this.parseLiteral("true", true);
    if (c === "f") return this.parseLiteral("false", false);
    if (c === "n") return this.parseLiteral("null", null);
    if (c === "-" || (c >= "0" && c <= "9")) return this.parseNumber();
    throw new JsonStrictParseError(
      `Unexpected character ${JSON.stringify(c)} at position ${this.pos}`,
    );
  }

  parseObject(): Record<string, unknown> {
    this.expect("{");
    const obj: Record<string, unknown> = Object.create(null);
    const seen = new Set<string>();
    this.skipWs();
    if (this.peek() === "}") {
      this.pos += 1;
      return obj;
    }
    while (true) {
      this.skipWs();
      if (this.peek() !== '"') {
        throw new JsonStrictParseError(
          `Expected object key at position ${this.pos}`,
        );
      }
      const key = this.parseString();
      if (seen.has(key)) {
        throw new JsonStrictParseError(`Duplicate key ${JSON.stringify(key)}`);
      }
      seen.add(key);
      this.skipWs();
      this.expect(":");
      obj[key] = this.parseValue();
      this.skipWs();
      const next = this.peek();
      if (next === ",") {
        this.pos += 1;
        this.skipWs();
        if (this.peek() === "}") {
          throw new JsonStrictParseError(
            `Trailing comma in object at position ${this.pos}`,
          );
        }
        continue;
      }
      if (next === "}") {
        this.pos += 1;
        return obj;
      }
      throw new JsonStrictParseError(
        `Expected ',' or '}' at position ${this.pos}`,
      );
    }
  }

  parseArray(): unknown[] {
    this.expect("[");
    const arr: unknown[] = [];
    this.skipWs();
    if (this.peek() === "]") {
      this.pos += 1;
      return arr;
    }
    while (true) {
      arr.push(this.parseValue());
      this.skipWs();
      const next = this.peek();
      if (next === ",") {
        this.pos += 1;
        this.skipWs();
        if (this.peek() === "]") {
          throw new JsonStrictParseError(
            `Trailing comma in array at position ${this.pos}`,
          );
        }
        continue;
      }
      if (next === "]") {
        this.pos += 1;
        return arr;
      }
      throw new JsonStrictParseError(
        `Expected ',' or ']' at position ${this.pos}`,
      );
    }
  }

  parseString(): string {
    this.expect('"');
    let out = "";
    const s = this.source;
    while (this.pos < s.length) {
      const c = s[this.pos]!;
      if (c === '"') {
        this.pos += 1;
        return out;
      }
      if (c === "\\") {
        this.pos += 1;
        out += this.parseEscape();
        continue;
      }
      if (c.charCodeAt(0) < 0x20) {
        throw new JsonStrictParseError(
          `Unescaped control character at position ${this.pos}`,
        );
      }
      out += c;
      this.pos += 1;
    }
    throw new JsonStrictParseError("Unterminated string");
  }

  parseEscape(): string {
    if (this.eof()) throw new JsonStrictParseError("Unterminated string escape");
    const c = this.source[this.pos]!;
    this.pos += 1;
    switch (c) {
      case '"':
      case "\\":
      case "/":
        return c;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u": {
        const hex = this.source.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new JsonStrictParseError(
            `Invalid unicode escape at position ${this.pos - 1}`,
          );
        }
        this.pos += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        throw new JsonStrictParseError(
          `Invalid escape \\${c} at position ${this.pos - 1}`,
        );
    }
  }

  parseNumber(): number {
    const start = this.pos;
    if (this.peek() === "-") this.pos += 1;
    if (this.peek() === "0") {
      this.pos += 1;
      if (this.peek() >= "0" && this.peek() <= "9") {
        throw new JsonStrictParseError(
          `Leading zero at position ${start}`,
        );
      }
    } else if (this.peek() >= "1" && this.peek() <= "9") {
      this.pos += 1;
      while (this.peek() >= "0" && this.peek() <= "9") this.pos += 1;
    } else {
      throw new JsonStrictParseError(`Invalid number at position ${start}`);
    }
    if (this.peek() === ".") {
      this.pos += 1;
      if (!(this.peek() >= "0" && this.peek() <= "9")) {
        throw new JsonStrictParseError(
          `Invalid fraction at position ${this.pos}`,
        );
      }
      while (this.peek() >= "0" && this.peek() <= "9") this.pos += 1;
    }
    const exp = this.peek();
    if (exp === "e" || exp === "E") {
      this.pos += 1;
      if (this.peek() === "+" || this.peek() === "-") this.pos += 1;
      if (!(this.peek() >= "0" && this.peek() <= "9")) {
        throw new JsonStrictParseError(
          `Invalid exponent at position ${this.pos}`,
        );
      }
      while (this.peek() >= "0" && this.peek() <= "9") this.pos += 1;
    }
    const raw = this.source.slice(start, this.pos);
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new JsonStrictParseError(`Invalid number ${raw}`);
    }
    return n;
  }

  parseLiteral<T>(token: string, value: T): T {
    if (this.source.slice(this.pos, this.pos + token.length) !== token) {
      throw new JsonStrictParseError(
        `Expected ${token} at position ${this.pos}`,
      );
    }
    this.pos += token.length;
    return value;
  }

  expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new JsonStrictParseError(
        `Expected ${JSON.stringify(ch)} at position ${this.pos}`,
      );
    }
    this.pos += 1;
  }
}
