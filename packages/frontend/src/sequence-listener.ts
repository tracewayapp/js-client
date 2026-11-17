export function listenForSequenceActions(
  observe: (
    type: "click" | "hover",
    matches: (selector: string) => boolean,
  ) => void,
): () => void {
  const onEvent = (event: Event) => {
    if (
      !event.isTrusted ||
      (event.type === "pointerover" &&
        event instanceof PointerEvent &&
        event.pointerType === "touch")
    )
      return;
    const elements = event
      .composedPath()
      .filter((node): node is Element => node instanceof Element)
      .slice(0, 64);
    const previous =
      event instanceof MouseEvent && event.relatedTarget instanceof Element
        ? event.relatedTarget
        : null;
    observe(event.type === "click" ? "click" : "hover", (selector) => {
      try {
        if (selector.length > 256 || /[:,\\]/.test(selector)) return false;
        const target = elements.find((element) => element.matches(selector));
        return (
          !!target &&
          !(
            event.type === "pointerover" &&
            previous &&
            target.contains(previous)
          )
        );
      } catch {
        return false;
      }
    });
  };
  document.addEventListener("click", onEvent, true);
  document.addEventListener("pointerover", onEvent, true);
  return () => {
    document.removeEventListener("click", onEvent, true);
    document.removeEventListener("pointerover", onEvent, true);
  };
}

export function hasSequenceEvent(value: unknown, types: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.some((v) => hasSequenceEvent(v, types));
  const record = value as Record<string, unknown>;
  const event = record.event as { type?: string } | undefined;
  return (
    (!!event?.type && types.includes(event.type)) ||
    Object.entries(record).some(
      ([key, v]) => key !== "event" && hasSequenceEvent(v, types),
    )
  );
}
