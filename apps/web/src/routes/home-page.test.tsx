import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { HomePage } from "./home-page";

describe("HomePage", () => {
  it("renders the product pitch", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );
    expect(screen.getByText("Run the gauntlet. Let chat build the match.")).toBeInTheDocument();
  });
});
