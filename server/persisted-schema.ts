import { z } from "zod";

/**
 * Builds the schema for READING a persisted file (insights cache, discovery
 * job, model settings, app settings) from the schema its writer uses.
 *
 * A file may have been written by a newer build, so the read schema is more
 * forgiving than the write side:
 * - objects drop unknown keys instead of rejecting them (strict and strip
 *   objects become strip; passthrough objects stay passthrough);
 * - string and array `max` lengths are multiplied by `capFactor` (default
 *   4), so a later build may raise an output cap within that margin; `min`
 *   and exact lengths are kept;
 * - everything else is kept as written: enums, literals, numbers, booleans,
 *   formats and regexes, refinements, transforms and defaults.
 *
 * Use it only where a persisted file is read. Agent output and request
 * input schemas stay strict.
 */
export function lenientRead<T extends z.ZodType>(
  schema: T,
  opts: { capFactor?: number } = {},
): z.ZodType<z.output<T>, z.input<T>> {
  const capFactor = opts.capFactor ?? 4;
  if (!Number.isFinite(capFactor) || capFactor < 1)
    throw new RangeError("capFactor must be a finite number of at least 1.");
  const relax = (limit: number) => Math.ceil(limit * capFactor);
  // Shared sub-schemas are rebuilt once, and z.lazy cycles end here.
  const rebuilt = new Map<z.core.$ZodType, z.core.$ZodType>();

  function lenient<S extends z.core.$ZodType>(node: S): S {
    let result = rebuilt.get(node);
    if (!result) {
      result = rebuild(node as unknown as z.core.$ZodTypes);
      rebuilt.set(node, result);
    }
    return result as S;
  }

  /** A copy of the node with some of its definition replaced. */
  function copy<S extends z.core.$ZodType>(node: S, changes: object): S {
    // mergeDefs keeps getters, such as a default's, as getters.
    return z.clone(node, z.util.mergeDefs(node._zod.def, changes));
  }

  /** The checks with every maximum length relaxed; the others as written. */
  function relaxed(checks: z.core.$ZodCheck[] | undefined) {
    return checks?.map((check) => {
      const def = check._zod.def;
      if (def.check !== "max_length") return check;
      // zod builds every check with its class in _zod.constr.
      const { constr: Check } = check._zod as unknown as {
        constr: new (def: z.core.$ZodCheckMaxLengthDef) => z.core.$ZodCheck;
      };
      const maxLength = def as z.core.$ZodCheckMaxLengthDef;
      return new Check({ ...maxLength, maximum: relax(maxLength.maximum) });
    });
  }

  function rebuild(node: z.core.$ZodTypes): z.core.$ZodType {
    const def = node._zod.def;
    switch (def.type) {
      case "object":
        return copy(node, {
          shape: Object.fromEntries(
            Object.entries(def.shape).map(([key, value]) => [key, lenient(value)]),
          ),
          // A strict object's catchall is never and a passthrough object's
          // unknown; without one, unknown keys are stripped.
          catchall:
            !def.catchall || def.catchall instanceof z.ZodNever
              ? undefined
              : lenient(def.catchall),
        });
      case "array":
        return copy(node, {
          element: lenient(def.element),
          checks: relaxed(def.checks),
        });
      case "string":
        return copy(node, { checks: relaxed(def.checks) });
      case "optional":
      case "nullable":
      case "default":
      case "prefault":
      case "catch":
      case "readonly":
      case "nonoptional":
        return copy(node, { innerType: lenient(def.innerType) });
      case "pipe":
        return copy(node, { in: lenient(def.in), out: lenient(def.out) });
      // A discriminated union is a union with a discriminator; zod maps its
      // options by discriminator value again from the new options.
      case "union":
        return copy(node, { options: def.options.map(lenient) });
      case "intersection":
        return copy(node, { left: lenient(def.left), right: lenient(def.right) });
      case "record":
        return copy(node, {
          keyType: lenient(def.keyType),
          valueType: lenient(def.valueType),
        });
      case "tuple":
        return copy(node, {
          items: def.items.map(lenient),
          rest: def.rest && lenient(def.rest),
        });
      case "lazy": {
        const getter = def.getter;
        // Rebuild what the getter returns once, on its first use. A new
        // z.lazy, because zod caches the resolved schema on the definition.
        let resolved: z.core.$ZodType | undefined;
        return z.lazy(() => (resolved ??= lenient(getter())));
      }
      // Enums, literals, numbers, booleans and other leaves keep their rules.
      default:
        return node;
    }
  }

  return lenient(schema) as z.ZodType<z.output<T>, z.input<T>>;
}
