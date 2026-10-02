package com.vocabtrainer.repository;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Converts plain JSON-ish Java values (maps, lists, strings, numbers, booleans)
 * to and from the typed "Value" format of the Firestore REST API, e.g.
 * 5 ⇄ {"integerValue":"5"}, {"a":1} ⇄ {"mapValue":{"fields":{"a":{"integerValue":"1"}}}}.
 */
final class FirestoreValues {

    private static final Pattern SIMPLE_SEGMENT = Pattern.compile("[A-Za-z_][A-Za-z_0-9]*");

    private FirestoreValues() {
    }

    static Map<String, Object> encodeFields(Map<String, ?> data) {
        Map<String, Object> fields = new LinkedHashMap<>();
        data.forEach((k, v) -> fields.put(k, encode(v)));
        return fields;
    }

    static Map<String, Object> encode(Object v) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (v == null) {
            out.put("nullValue", null);
        } else if (v instanceof Boolean b) {
            out.put("booleanValue", b);
        } else if (v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof Byte
                || v instanceof BigInteger) {
            out.put("integerValue", v.toString());
        } else if (v instanceof BigDecimal d) {
            putDecimal(out, d);
        } else if (v instanceof Number n) {
            double d = n.doubleValue();
            if (d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 9.007199254740992E15) {
                out.put("integerValue", Long.toString((long) d));
            } else {
                out.put("doubleValue", d);
            }
        } else if (v instanceof CharSequence s) {
            out.put("stringValue", s.toString());
        } else if (v instanceof Map<?, ?> m) {
            Map<String, Object> fields = new LinkedHashMap<>();
            m.forEach((k, val) -> fields.put(String.valueOf(k), encode(val)));
            out.put("mapValue", Map.of("fields", fields));
        } else if (v instanceof List<?> list) {
            List<Object> values = new ArrayList<>();
            list.forEach(x -> values.add(encode(x)));
            out.put("arrayValue", Map.of("values", values));
        } else {
            throw new IllegalArgumentException("unsupported value type: " + v.getClass().getSimpleName());
        }
        return out;
    }

    private static void putDecimal(Map<String, Object> out, BigDecimal d) {
        try {
            out.put("integerValue", d.toBigIntegerExact().toString());
        } catch (ArithmeticException notWhole) {
            out.put("doubleValue", d.doubleValue());
        }
    }

    static Map<String, Object> decodeFields(Map<String, ?> fields) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (fields != null) {
            fields.forEach((k, v) -> out.put(k, decode(v)));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    static Object decode(Object raw) {
        if (!(raw instanceof Map<?, ?> value)) {
            return null;
        }
        if (value.containsKey("integerValue")) {
            return Long.parseLong(String.valueOf(value.get("integerValue")));
        }
        if (value.containsKey("doubleValue")) {
            Object d = value.get("doubleValue");
            return d instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(d));
        }
        if (value.containsKey("stringValue")) {
            return value.get("stringValue");
        }
        if (value.containsKey("booleanValue")) {
            return value.get("booleanValue");
        }
        if (value.containsKey("mapValue")) {
            Map<String, Object> mv = (Map<String, Object>) value.get("mapValue");
            return decodeFields(mv == null ? null : (Map<String, Object>) mv.get("fields"));
        }
        if (value.containsKey("arrayValue")) {
            Map<String, Object> av = (Map<String, Object>) value.get("arrayValue");
            List<Object> values = av == null ? null : (List<Object>) av.get("values");
            List<Object> out = new ArrayList<>();
            if (values != null) {
                values.forEach(x -> out.add(decode(x)));
            }
            return out;
        }
        if (value.containsKey("timestampValue")) {
            return value.get("timestampValue");
        }
        return null; // nullValue, and types this app never writes
    }

    /** A field path for update masks / transforms, quoting segments like `B1|der|der Hund`. */
    static String fieldPath(String... segments) {
        StringBuilder sb = new StringBuilder();
        for (String seg : segments) {
            if (!sb.isEmpty()) {
                sb.append('.');
            }
            if (SIMPLE_SEGMENT.matcher(seg).matches()) {
                sb.append(seg);
            } else {
                sb.append('`').append(seg.replace("\\", "\\\\").replace("`", "\\`")).append('`');
            }
        }
        return sb.toString();
    }
}
