import * as React from "react";
import { Input } from "@/components/ui/input";

type DraftNumberInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  value: number;
  integer?: boolean;
  onValueChange: (value: number) => void;
  onInvalidValue?: (rawValue: string) => void;
  onDraftRestore?: () => void;
};

/**
 * Keeps transient editing text local so clearing a controlled number input does
 * not immediately turn Number("") into zero in the owning state.
 */
export function DraftNumberInput({
  value,
  integer = false,
  onValueChange,
  onInvalidValue,
  onDraftRestore,
  onBlur,
  min,
  max,
  ...props
}: DraftNumberInputProps) {
  const [draft, setDraft] = React.useState(String(value));
  const acceptedValue = React.useRef(value);

  React.useEffect(() => {
    acceptedValue.current = value;
    setDraft(String(value));
  }, [value]);

  const isWithinBounds = (nextValue: number) => {
    const minimum = min === undefined ? undefined : Number(min);
    const maximum = max === undefined ? undefined : Number(max);
    return (
      (minimum === undefined || nextValue >= minimum) &&
      (maximum === undefined || nextValue <= maximum)
    );
  };

  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => {
        const rawValue = event.target.value;
        setDraft(rawValue);
        if (!rawValue.trim()) return;
        const nextValue = Number(rawValue);
        if (
          Number.isFinite(nextValue) &&
          (!integer || Number.isInteger(nextValue)) &&
          isWithinBounds(nextValue)
        ) {
          acceptedValue.current = nextValue;
          onValueChange(nextValue);
        } else {
          onInvalidValue?.(rawValue);
        }
      }}
      onBlur={(event) => {
        setDraft(String(acceptedValue.current));
        onDraftRestore?.();
        onBlur?.(event);
      }}
    />
  );
}
