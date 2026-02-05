import { startSpan, endSpan } from "@tracewayapp/backend";

export function Span(name?: string): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const spanName = name || String(propertyKey);

    descriptor.value = function (...args: unknown[]) {
      const span = startSpan(spanName);

      try {
        const result = originalMethod.apply(this, args);

        if (result && typeof result.then === "function") {
          return result
            .then((value: unknown) => {
              endSpan(span);
              return value;
            })
            .catch((error: unknown) => {
              endSpan(span);
              throw error;
            });
        }

        endSpan(span);
        return result;
      } catch (error) {
        endSpan(span);
        throw error;
      }
    };

    return descriptor;
  };
}
