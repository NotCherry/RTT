// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftNumberInput } from "./draft-number-input";

afterEach(cleanup);

describe("DraftNumberInput", () => {
  it("keeps an empty draft until the user types a replacement", () => {
    const onValueChange = vi.fn();
    render(
      <DraftNumberInput
        aria-label="Amount"
        value={0}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Amount" });

    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "5" } });
    expect(onValueChange).toHaveBeenCalledWith(5);
  });

  it("restores the accepted value on blur and removes leading zeroes", () => {
    render(
      <DraftNumberInput
        aria-label="Amount"
        value={5}
        onValueChange={() => {}}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Amount" });

    fireEvent.change(input, { target: { value: "05" } });
    fireEvent.blur(input);

    expect(input).toHaveValue(5);
    expect(input).toHaveAttribute("value", "5");
  });

  it("does not commit values outside its bounds", () => {
    const onValueChange = vi.fn();
    const onInvalidValue = vi.fn();
    render(
      <DraftNumberInput
        aria-label="Amount"
        min={1}
        max={10}
        value={5}
        onValueChange={onValueChange}
        onInvalidValue={onInvalidValue}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Amount" });

    fireEvent.change(input, { target: { value: "11" } });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onInvalidValue).toHaveBeenCalledWith("11");

    fireEvent.blur(input);
    expect(input).toHaveValue(5);
  });

  it("does not commit a decimal to an integer field", () => {
    const onValueChange = vi.fn();
    render(
      <DraftNumberInput
        integer
        aria-label="Count"
        value={5}
        onValueChange={onValueChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Count" }), {
      target: { value: "5.5" },
    });

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
