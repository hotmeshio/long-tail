# @pipe Function Reference

Complete catalog of operators available in HotMesh `@pipe` expressions.
Invoked as `{@category.method}` in YAML mapping rules.

All pipes use RPN (Reverse Polish Notation): operands appear as cells in a row, operator on the
next row appears in cell 1. It receives as arguments the items in the row above. And then cell 1 'resolves'
and the entire row of cells becomes the operands to feed into the operator on cell 1 of the next row. And then cell 1 'resolves'...

Subpipes are used whenn other cells beyond cell 1 need inputs as well. Each parameter becomes a subpipe (recursive pipe intance of its own)
Subpipes nest forever.

---

## @string (20 methods)

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| charAt | (str, index) | string | Character at position |
| concat | (...strings) | string | Join all arguments |
| endsWith | (str, search, length?) | boolean | |
| includes | (str, search, position?) | boolean | |
| indexOf | (str, search, fromIndex?) | number | -1 if not found |
| lastIndexOf | (str, search, fromIndex?) | number | -1 if not found |
| padEnd | (str, maxLength, padStr?) | string | |
| padStart | (str, maxLength, padStr?) | string | |
| repeat | (str, count) | string | |
| replace | (str, search, replace) | string | First occurrence only |
| search | (str, regexp) | number | |
| slice | (str, start?, end?) | string | |
| split | (str, delimiter) | string[] | |
| startsWith | (str, search, position?) | boolean | |
| substring | (str, start, end?) | string | Negative indices treated as 0 |
| toLowerCase | (str) | string | |
| toUpperCase | (str) | string | |
| trim | (str) | string | |
| trimEnd | (str) | string | |
| trimStart | (str) | string | |

---

## @date (30+ methods)

### Utility
| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| now | () | number | Epoch milliseconds |
| yyyymmdd | () | string | Today as "YYYY-MM-DD" (UTC). **Preferred for date strings** |
| parse | (dateString) | number | Parse string → epoch ms |
| fromISOString | (isoString) | Date | ISO 8601 string → Date |
| UTC | (year, month, date?, hrs?, min?, sec?, ms?) | number | Components → epoch ms |

### Formatting
| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| toISOString | (date) | string | ISO 8601 format |
| toDateString | (date) | string | Human-readable date portion |
| toJSON | (date) | string | JSON-compatible string |
| toString | (date) | string | Default format with timezone |
| toLocaleDateString | (date, locales?, options?) | string | |
| toLocaleString | (date, locales?, options?) | string | |
| toLocaleTimeString | (date, locales?, options?) | string | |
| toISOXString | (date?) | string | Compact: "20240423123456.789" |
| valueOf | (date) | number | Epoch ms |

### Getters (local time)
| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| getFullYear | (date) | number | 4-digit year |
| getMonth | (date) | number | 0–11 (0 = January) |
| getDate | (date) | number | 1–31 |
| getDay | (date) | number | 0–6 (0 = Sunday) |
| getHours | (date) | number | 0–23 |
| getMinutes | (date) | number | 0–59 |
| getSeconds | (date) | number | 0–59 |
| getMilliseconds | (date) | number | 0–999 |
| getTime | (date) | number | Epoch ms |
| getTimezoneOffset | (date) | number | Minutes from UTC |

### Getters (UTC)
`getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCDay`, `getUTCHours`,
`getUTCMinutes`, `getUTCSeconds`, `getUTCMilliseconds` — same signatures, UTC time.

### Setters (local and UTC)
`setFullYear`, `setMonth`, `setDate`, `setHours`, `setMinutes`, `setSeconds`,
`setMilliseconds`, `setTime` — mutate and return epoch ms.
UTC variants: `setUTCFullYear`, `setUTCMonth`, `setUTCDate`, `setUTCHours`,
`setUTCMinutes`, `setUTCSeconds`, `setUTCMilliseconds`.

---

## @math (40+ methods)

### Arithmetic
| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| add | (...operands) | number | Sum all |
| subtract | (...operands) | number | Sequential subtraction |
| multiply | (...operands) | number | Product of all |
| divide | (...operands) | number | Sequential; NaN on /0 |

### Rounding
| Method | Signature | Returns |
|--------|-----------|---------|
| abs | (x) | number |
| ceil | (x) | number |
| floor | (x) | number |
| round | (x) | number |
| trunc | (x) | number |
| fround | (x) | number |
| sign | (x) | number |

### Exponential / Logarithmic
| Method | Signature | Returns |
|--------|-----------|---------|
| exp | (x) | number |
| expm1 | (x) | number |
| log | (x) | number |
| log1p | (x) | number |
| log2 | (x) | number |
| log10 | (x) | number |
| pow | (x, y) | number |
| sqrt | (x) | number |
| cbrt | (x) | number |
| hypot | (...values) | number |

### Trigonometric
`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2` — standard radian-based.

### Hyperbolic
`sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`.

### Comparison / Utility
| Method | Signature | Returns |
|--------|-----------|---------|
| max | (...values) | number |
| min | (...values) | number |
| random | () | number |
| imul | (x, y) | number |
| clz32 | (x) | number |

---

## @number (19 methods)

### Comparison
| Method | Signature | Returns |
|--------|-----------|---------|
| gt | (input, compare) | boolean |
| gte | (input, compare) | boolean |
| lt | (input, compare) | boolean |
| lte | (input, compare) | boolean |

### Type checking
| Method | Signature | Returns |
|--------|-----------|---------|
| isFinite | (input) | boolean |
| isInteger | (input) | boolean |
| isEven | (input) | boolean |
| isOdd | (input) | boolean |
| isNaN | (input) | boolean |

### Parsing
| Method | Signature | Returns |
|--------|-----------|---------|
| parseFloat | (input) | number |
| parseInt | (input, radix?) | number |

### Formatting
| Method | Signature | Returns |
|--------|-----------|---------|
| toFixed | (input, digits?) | string |
| toExponential | (input, fractionalDigits?) | string |
| toPrecision | (input, precision?) | string |

### Math shortcuts
`round`, `pow`, `max`, `min` — same as @math equivalents.

---

## @array (14 methods)

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| concat | (arr1, arr2) | array | Merge arrays |
| get | (arr, index) | any | Element at position |
| indexOf | (arr, element, from?) | number | -1 if absent |
| join | (arr, separator) | string | |
| lastIndexOf | (arr, element, from?) | number | |
| length | (arr) | number | |
| pop | (arr) | any | Remove + return last |
| push | (arr, ...items) | array | Append items |
| reverse | (arr) | array | In-place reverse |
| shift | (arr) | any | Remove + return first |
| slice | (arr, start?, end?) | array | Shallow copy portion |
| sort | (arr, order?) | array | "asc" (default) or "desc" |
| splice | (arr, start, deleteCount?, ...items) | array | Remove/replace |
| unshift | (arr, ...items) | number | Prepend, return new length |

---

## @object (22 methods)

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| get | (obj, prop) | any | Property value |
| set | (obj, prop, value) | object | Set and return object |
| create | (...args) | object | Alternating key-value pairs |
| keys | (obj) | string[] | |
| values | (obj) | any[] | |
| entries | (obj) | [key, value][] | |
| fromEntries | (iterable) | object | |
| assign | (target, ...sources) | object | Merge sources into target |
| hasOwnProperty | (obj, prop) | boolean | |
| freeze | (obj) | object | Make immutable |
| isFrozen | (obj) | boolean | |
| seal | (obj) | object | Prevent new properties |
| isSealed | (obj) | boolean | |
| preventExtensions | (obj) | object | |
| isExtensible | (obj) | boolean | |
| getOwnPropertyNames | (obj) | string[] | Including non-enumerable |
| getOwnPropertySymbols | (obj) | symbol[] | |
| getOwnPropertyDescriptor | (obj, prop) | descriptor | |
| defineProperty | (obj, prop, descriptor) | object | |
| defineProperties | (obj, props) | object | |
| isPrototypeOf | (obj, proto) | boolean | |
| propertyIsEnumerable | (obj, prop) | boolean | |

---

## @conditional (10 methods)

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| ternary | (condition, ifTrue, ifFalse) | any | `condition ? a : b` |
| equality | (a, b) | boolean | Loose `==` |
| strict_equality | (a, b) | boolean | Strict `===` |
| inequality | (a, b) | boolean | Loose `!=` |
| strict_inequality | (a, b) | boolean | Strict `!==` |
| greater_than | (a, b) | boolean | `a > b` |
| less_than | (a, b) | boolean | `a < b` |
| greater_than_or_equal | (a, b) | boolean | `a >= b` |
| less_than_or_equal | (a, b) | boolean | `a <= b` |
| nullish | (a, b) | any | `a ?? b` |

---

## @json (2 methods)

| Method | Signature | Returns |
|--------|-----------|---------|
| parse | (text, reviver?) | any |
| stringify | (value, replacer?, space?) | string |

---

## @logical (2 methods)

| Method | Signature | Returns |
|--------|-----------|---------|
| and | (a, b) | boolean |
| or | (a, b) | boolean |

---

## @bitwise (6 methods)

| Method | Signature | Returns |
|--------|-----------|---------|
| and | (a, b) | number |
| or | (a, b) | number |
| xor | (a, b) | number |
| leftShift | (a, b) | number |
| rightShift | (a, b) | number |
| unsignedRightShift | (a, b) | number |

---

## @symbol / @unary

These handlers exist in the registry but are rarely needed in workflow construction.
`@symbol` provides Symbol operations. `@unary` provides typeof, void, delete, and
bitwise NOT.
