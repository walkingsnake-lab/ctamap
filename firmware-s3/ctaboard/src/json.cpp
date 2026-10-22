#include "json.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace json {

const Value &Value::null_value() {
  static const Value v;
  return v;
}

bool Value::truthy() const {
  switch (type) {
    case NUL: return false;
    case BOOL: return b;
    case NUM: return n != 0;
    case STR: return !s.empty();
    case ARR: return !a.empty();
    case OBJ: return !o.empty();
  }
  return false;
}

const Value &Value::operator[](const char *key) const {
  if (type == OBJ) {
    for (const auto &kv : o)
      if (kv.first == key) return kv.second;
  }
  return null_value();
}

const Value &Value::operator[](size_t i) const {
  if (type == ARR && i < a.size()) return a[i];
  return null_value();
}

bool Value::has(const char *key) const {
  if (type != OBJ) return false;
  for (const auto &kv : o)
    if (kv.first == key) return true;
  return false;
}

// ---- parser ----

namespace {

struct Parser {
  const char *p;
  const char *end;
  std::string err;
  int depth = 0;

  void ws() {
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++;
  }

  bool fail(const char *why) {
    if (err.empty()) err = why;
    return false;
  }

  static void put_utf8(std::string &out, uint32_t cp) {
    if (cp < 0x80) {
      out += (char)cp;
    } else if (cp < 0x800) {
      out += (char)(0xC0 | (cp >> 6));
      out += (char)(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      out += (char)(0xE0 | (cp >> 12));
      out += (char)(0x80 | ((cp >> 6) & 0x3F));
      out += (char)(0x80 | (cp & 0x3F));
    } else {
      out += (char)(0xF0 | (cp >> 18));
      out += (char)(0x80 | ((cp >> 12) & 0x3F));
      out += (char)(0x80 | ((cp >> 6) & 0x3F));
      out += (char)(0x80 | (cp & 0x3F));
    }
  }

  bool hex4(uint32_t &v) {
    if (end - p < 4) return fail("short \\u escape");
    v = 0;
    for (int i = 0; i < 4; i++) {
      char c = *p++;
      v <<= 4;
      if (c >= '0' && c <= '9') v |= c - '0';
      else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
      else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
      else return fail("bad \\u escape");
    }
    return true;
  }

  bool string(std::string &out) {
    if (p >= end || *p != '"') return fail("expected string");
    p++;
    while (p < end && *p != '"') {
      char c = *p++;
      if (c != '\\') {
        out += c;
        continue;
      }
      if (p >= end) return fail("bad escape");
      char e = *p++;
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          uint32_t cp;
          if (!hex4(cp)) return false;
          if (cp >= 0xD800 && cp <= 0xDBFF && end - p >= 6 && p[0] == '\\' && p[1] == 'u') {
            p += 2;
            uint32_t lo;
            if (!hex4(lo)) return false;
            if (lo >= 0xDC00 && lo <= 0xDFFF) cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          }
          put_utf8(out, cp);
          break;
        }
        default: return fail("bad escape");
      }
    }
    if (p >= end) return fail("unterminated string");
    p++;
    return true;
  }

  bool number(Value &v) {
    const char *start = p;
    bool is_int = true;
    if (p < end && *p == '-') p++;
    while (p < end && ((*p >= '0' && *p <= '9') || *p == '.' || *p == 'e' || *p == 'E' || *p == '+' || *p == '-')) {
      if (*p == '.' || *p == 'e' || *p == 'E') is_int = false;
      p++;
    }
    std::string text(start, p - start);
    char *stop = nullptr;
    double n = strtod(text.c_str(), &stop);
    if (stop == text.c_str() || *stop) return fail("bad number");
    v.type = NUM;
    v.n = n;
    v.is_int = is_int;
    return true;
  }

  bool literal(const char *word) {
    size_t n = strlen(word);
    if ((size_t)(end - p) < n || strncmp(p, word, n) != 0) return fail("bad literal");
    p += n;
    return true;
  }

  bool value(Value &v) {
    if (++depth > 64) return fail("too deep");
    ws();
    if (p >= end) return fail("unexpected end");
    bool ok = true;
    char c = *p;
    if (c == '{') {
      p++;
      v.type = OBJ;
      ws();
      if (p < end && *p == '}') {
        p++;
      } else {
        while (true) {
          ws();
          std::string key;
          if (!string(key)) { ok = false; break; }
          ws();
          if (p >= end || *p != ':') { ok = fail("expected ':'"); break; }
          p++;
          v.o.emplace_back(std::move(key), Value());
          if (!value(v.o.back().second)) { ok = false; break; }
          ws();
          if (p < end && *p == ',') { p++; continue; }
          if (p < end && *p == '}') { p++; break; }
          ok = fail("expected ',' or '}'");
          break;
        }
      }
    } else if (c == '[') {
      p++;
      v.type = ARR;
      ws();
      if (p < end && *p == ']') {
        p++;
      } else {
        while (true) {
          v.a.emplace_back();
          if (!value(v.a.back())) { ok = false; break; }
          ws();
          if (p < end && *p == ',') { p++; continue; }
          if (p < end && *p == ']') { p++; break; }
          ok = fail("expected ',' or ']'");
          break;
        }
      }
    } else if (c == '"') {
      v.type = STR;
      ok = string(v.s);
    } else if (c == 't') {
      v.type = BOOL;
      v.b = true;
      ok = literal("true");
    } else if (c == 'f') {
      v.type = BOOL;
      v.b = false;
      ok = literal("false");
    } else if (c == 'n') {
      v.type = NUL;
      ok = literal("null");
    } else {
      ok = number(v);
    }
    depth--;
    return ok;
  }
};

}  // namespace

bool parse(const char *text, size_t len, Value &out, std::string *err) {
  Parser ps;
  ps.p = text;
  ps.end = text + len;
  out = Value();
  bool ok = ps.value(out);
  if (ok) {
    ps.ws();
    if (ps.p != ps.end) ok = ps.fail("trailing data");
  }
  if (!ok) {
    out = Value();
    if (err) *err = ps.err;
  }
  return ok;
}

bool parse(const std::string &text, Value &out, std::string *err) {
  return parse(text.data(), text.size(), out, err);
}

std::string num_str(double n, bool is_int) {
  char buf[40];
  if (is_int && fabs(n) < 9e15) {
    snprintf(buf, sizeof buf, "%lld", (long long)n);
    return buf;
  }
  if (isnan(n)) return "nan";
  if (isinf(n)) return n > 0 ? "inf" : "-inf";
  // Shortest form that reads back the same, like Python's repr.
  for (int prec = 1; prec <= 17; prec++) {
    snprintf(buf, sizeof buf, "%.*g", prec, n);
    if (strtod(buf, nullptr) == n) break;
  }
  std::string s = buf;
  if (s.find_first_of(".eni") == std::string::npos) s += ".0";
  return s;
}

std::string str(const Value &v) {
  switch (v.type) {
    case NUL: return "None";
    case BOOL: return v.b ? "True" : "False";
    case NUM: return num_str(v.n, v.is_int);
    case STR: return v.s;
    default: return "";
  }
}

}  // namespace json
