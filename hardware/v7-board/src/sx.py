"""a small s-expression reader and writer for KiCad files"""
class Q(str):
    """a string that was quoted in the file"""
def parse(text):
    i, n = 0, len(text)
    def node():
        nonlocal i
        out = []
        while i < n:
            c = text[i]
            if c == '(':
                i += 1; out.append(node())
            elif c == ')':
                i += 1; return out
            elif c == '"':
                j = i + 1; buf = []
                while text[j] != '"':
                    if text[j] == '\\': buf.append(text[j:j + 2]); j += 2
                    else: buf.append(text[j]); j += 1
                out.append(Q(''.join(buf))); i = j + 1
            elif c.isspace():
                i += 1
            else:
                j = i
                while j < n and not text[j].isspace() and text[j] not in '()': j += 1
                out.append(text[i:j]); i = j
        return out
    return node()[0]
def dump(n, ind=0):
    if isinstance(n, Q): return '"' + n + '"'
    if not isinstance(n, list): return str(n)
    flat = '(' + ' '.join(dump(c) for c in n) + ')'
    if len(flat) < 110 or ind > 8: return flat
    pad = '\n' + '  ' * (ind + 1)
    return '(' + dump(n[0]) + ''.join(pad + dump(c, ind + 1) for c in n[1:]) + '\n' + '  ' * ind + ')'
def find(n, name): return [c for c in n if isinstance(c, list) and c and c[0] == name]
