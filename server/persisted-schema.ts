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
export function lenientRead<T extends z.ZodTypeAny>(
  schema: T,
  opts: { capFactor?: number } = {},
): z.ZodType<z.output<T>, z.ZodTypeDef, z.input<T>> {
  const capFactor = opts.capFactor ?? 4;
  if (!Number.isFinite(capFactor) || capFactor < 1)
    throw new RangeError("capFactor must be a finite number of at least 1.");
  const relax = (limit: number) => Math.ceil(limit * capFactor);
  // Shared sub-schemas are rebuilt once, and z.lazy cycles end here.
  const rebuilt = new Map<z.ZodTypeAny, z.ZodTypeAny>();

  function lenient(node: z.ZodTypeAny): z.ZodTypeAny {
    let result = rebuilt.get(node);
    if (!result) {
      result = rebuild(node);
      rebuilt.set(node, result);
    }
    return result;
  }

  function rebuild(node: z.ZodTypeAny): z.ZodTypeAny {
    if (node instanceof z.ZodObject) {
      const def = node._def;
      const shape = Object.fromEntries(
        Object.entries(def.shape() as z.ZodRawShape).map(([key, value]) => [
          key,
          lenient(value),
        ]),
      );
      return new z.ZodObject({
        ...def,
        shape: () => shape,
        unknownKeys:
          def.unknownKeys === "passthrough" ? "passthrough" : "strip",
        catchall: lenient(def.catchall),
      });
    }
    if (node instanceof z.ZodArray) {
      const def = node._def;
      return new z.ZodArray({
        ...def,
        type: lenient(def.type),
        maxLength: def.maxLength && {
          ...def.maxLength,
          value: relax(def.maxLength.value),
        },
      });
    }
    if (node instanceof z.ZodString) {
      const def = node._def;
      return new z.ZodString({
        ...def,
        checks: def.checks.map((check) =>
          check.kind === "max"
            ? { ...check, value: relax(check.value) }
            : check,
        ),
      });
    }
    if (
      node instanceof z.ZodOptional ||
      node instanceof z.ZodNullable ||
      node instanceof z.ZodDefault ||
      node instanceof z.ZodCatch ||
      node instanceof z.ZodReadonly
    ) {
      const Wrapper = node.constructor as new (
        def: z.ZodTypeDef & { innerType: z.ZodTypeAny },
      ) => z.ZodTypeAny;
      return new Wrapper({
        ...node._def,
        innerType: lenient(node._def.innerType),
      });
    }
    if (node instanceof z.ZodEffects)
      return new z.ZodEffects({
        ...node._def,
        schema: lenient(node._def.schema),
      });
    if (node instanceof z.ZodUnion)
      return new z.ZodUnion({
        ...node._def,
        options: node._def.options.map(lenient),
      });
    if (node instanceof z.ZodDiscriminatedUnion) {
      const def = node._def;
      // The options map is keyed by discriminator value; let zod rebuild it.
      const fresh = z.ZodDiscriminatedUnion.create(
        def.discriminator,
        def.options.map(lenient) as [
          z.ZodDiscriminatedUnionOption<string>,
          ...z.ZodDiscriminatedUnionOption<string>[],
        ],
      );
      return new z.ZodDiscriminatedUnion({
        ...def,
        options: fresh._def.options,
        optionsMap: fresh._def.optionsMap,
      });
    }
    if (node instanceof z.ZodIntersection)
      return new z.ZodIntersection({
        ...node._def,
        left: lenient(node._def.left),
        right: lenient(node._def.right),
      });
    if (node instanceof z.ZodRecord)
      return new z.ZodRecord({
        ...node._def,
        keyType: lenient(node._def.keyType),
        valueType: lenient(node._def.valueType),
      });
    if (node instanceof z.ZodTuple)
      return new z.ZodTuple({
        ...node._def,
        items: node._def.items.map(lenient),
        rest: node._def.rest && lenient(node._def.rest),
      });
    if (node instanceof z.ZodLazy) {
      const getter = node._def.getter;
      return new z.ZodLazy({ ...node._def, getter: () => lenient(getter()) });
    }
    if (node instanceof z.ZodPipeline)
      return new z.ZodPipeline({
        ...node._def,
        in: lenient(node._def.in),
        out: lenient(node._def.out),
      });
    if (node instanceof z.ZodBranded)
      return new z.ZodBranded({ ...node._def, type: lenient(node._def.type) });
    // Enums, literals, numbers, booleans and other leaves keep their rules.
    return node;
  }

  return lenient(schema);
}
