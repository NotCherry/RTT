// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DatasetPanel } from "./DatasetPanel";

describe("DatasetPanel", () => {
  it("offers an explicit delete action for each browser-saved dataset", () => {
    const onDelete = vi.fn();
    render(
      <DatasetPanel
        datasets={[
          {
            id: "dataset-1",
            name: "Greeting gestures",
            demonstration_ids: [],
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:00.000Z",
          },
        ]}
        activeDatasetId="dataset-1"
        demonstrations={[]}
        onSelect={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onDelete={onDelete}
        onMoveDemonstration={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Greeting gestures" }),
    );
    expect(onDelete).toHaveBeenCalledWith("dataset-1");
  });
});
