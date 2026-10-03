import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Die } from "./Die";

describe("<Die>", () => {
  it("draws the right number of pips", () => {
    const { container } = render(<Die index={0} value={5} />);
    expect(container.querySelectorAll("circle")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Die 1: 5" })).toBeDisabled();
  });

  it("toggles when farming is allowed", async () => {
    const onToggle = vi.fn();
    render(<Die index={2} value={3} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Die 3: 3" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("cannot be clicked once locked (already farmed)", () => {
    render(<Die index={0} value={6} held locked onToggle={() => {}} />);
    const die = screen.getByRole("button", { name: "Die 1: 6, held" });
    expect(die).toBeDisabled();
    expect(die).toHaveAttribute("aria-pressed", "true");
  });
});
