// A small JSON tree for the board's payloads (/board/update, /board/version).
//
// The renderer reads payloads the way firmware/boardlib/draw.py reads its
// dicts, so Value mirrors Python's semantics where draw.py relies on them:
//   v["key"]     - p.get('key'): the value, or null when missing
//   v.has("key") - 'key' in p
//   v.truthy()   - Python truthiness: null, false, 0, "", [] and {} are false
//   str(v)       - Python's str(): numbers that were integers in the JSON
//                  print without a decimal point
// No dependencies, so the same code runs on the board and in the native
// parity tests (firmware-s3/tests).
#pragma once

#include <stddef.h>
#include <stdint.h>

#include <string>
#include <utility>
#include <vector>

namespace json {

enum Type { NUL, BOOL, NUM, STR, ARR, OBJ };

struct Value {
  Type type = NUL;
  bool b = false;
  double n = 0;
  bool is_int = false;  // the number had no fraction or exponent in the JSON
  std::string s;        // UTF-8
  std::vector<Value> a;
  std::vector<std::pair<std::string, Value>> o;  // in document order

  bool is_null() const { return type == NUL; }
  bool is_num() const { return type == NUM; }
  bool is_str() const { return type == STR; }
  bool is_arr() const { return type == ARR; }
  bool is_obj() const { return type == OBJ; }
  bool is_true() const { return type == BOOL && b; }    // `x is True`
  bool is_false() const { return type == BOOL && !b; }  // `x is False`

  bool truthy() const;
  size_t size() const { return type == ARR ? a.size() : type == OBJ ? o.size() : 0; }

  // Member or element; a shared null when missing or out of range.
  const Value &operator[](const char *key) const;
  const Value &operator[](const std::string &key) const { return (*this)[key.c_str()]; }
  const Value &operator[](size_t i) const;
  const Value &operator[](int i) const { return (*this)[(size_t)(i < 0 ? (size_t)-1 : (size_t)i)]; }
  bool has(const char *key) const;

  double num(double def = 0) const { return type == NUM ? n : def; }
  const std::string &str_or(const std::string &def) const { return type == STR ? s : def; }
  bool eq(const char *text) const { return type == STR && s == text; }

  static const Value &null_value();
};

// Parses text into out. Returns false (and a message in err) on bad JSON.
bool parse(const char *text, size_t len, Value &out, std::string *err = nullptr);
bool parse(const std::string &text, Value &out, std::string *err = nullptr);

// Python's str() of a value: integers as "12", other numbers as the
// shortest round-trip form, strings as themselves, null as "None".
std::string str(const Value &v);
std::string num_str(double n, bool is_int);

}  // namespace json
