import { describe, expect, test } from "vitest";
import { componentProps, componentUses } from "../src/core/system/props";

const BUTTON = `import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("inline-flex items-center gap-2", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      destructive: "bg-destructive text-white",
      outline: "border bg-background",
    },
    size: {
      default: "h-9 px-4",
      sm: "h-8 px-3",
      "icon-sm": "size-8",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
`;

const RECIPE = `export function RecipeCard({ title, time, servings = 2 }: { title: string; time?: string; servings?: number }) {
  return (
    <article>
      <h2>{title}</h2>
      <p>Don't rush it: {time ?? "as long as it takes"}</p>
      <p>Serves {servings}</p>
    </article>
  );
}

export function RecipeMeta({ minutes }: { minutes: number }) {
  return <span>{minutes / 60} h</span>;
}
`;

const CALLOUT = `import * as React from "react"

interface CalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  /** What the callout is about. */
  tone:
    | "info"
    | "danger"
  title?: string
  onDismiss?(): void
}

export const Callout = ({ tone, title = "Note", ...rest }: CalloutProps) => (
  <div data-tone={tone} {...rest}>{title}</div>
)
`;

const INPUT = `import * as React from "react";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "md";
  invalid?: boolean;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, size = "md", ...props }, ref) => (
  <input ref={ref} className={className} data-size={size} {...props} />
));
Input.displayName = "Input";

export const Badge = React.memo(function Badge({ label }: { label: string }) {
  return <span>{label}</span>;
});

export { Input };
`;

const prop = (name: string, fields: { default?: string; required?: boolean; options?: string[]; type?: string } = {}) => ({
  name,
  default: fields.default ?? null,
  required: fields.required ?? null,
  options: fields.options ?? null,
  type: fields.type ?? null,
});

describe("componentProps", () => {
  test("a cva button lists its variants with their defaults, and the props its own type literal adds", () => {
    expect(componentProps(new Map([["src/button.tsx", BUTTON]]), ["Button"])).toEqual({
      Button: [
        prop("className"),
        prop("variant", { default: '"default"', required: false, options: ["default", "destructive", "outline"] }),
        prop("size", { default: '"default"', required: false, options: ["default", "sm", "icon-sm"] }),
        prop("asChild", { default: "false", required: false, type: "boolean" }),
      ],
    });
  });

  test("an inline type literal gives each prop's type and whether it's required, and a later component still reads", () => {
    expect(componentProps(new Map([["src/recipe.tsx", RECIPE]]), ["RecipeCard", "RecipeMeta"])).toEqual({
      RecipeCard: [
        prop("title", { required: true, type: "string" }),
        prop("time", { required: false, type: "string" }),
        prop("servings", { default: "2", required: false, type: "number" }),
      ],
      RecipeMeta: [prop("minutes", { required: true, type: "number" })],
    });
  });

  test("an interface's string union becomes options, its methods are props, and what it extends from React is skipped", () => {
    expect(componentProps(new Map([["src/callout.tsx", CALLOUT]]), ["Callout"])).toEqual({
      Callout: [
        prop("tone", { required: true, options: ["info", "danger"], type: '"info" | "danger"' }),
        prop("title", { default: '"Note"', required: false, type: "string" }),
        prop("onDismiss", { required: false, type: "(): void" }),
      ],
    });
  });

  test("forwardRef takes its props type from the type arguments, and memo reads the function inside it", () => {
    expect(componentProps(new Map([["src/input.tsx", INPUT]]), ["Input", "Badge"])).toEqual({
      Input: [prop("className"), prop("size", { default: '"md"', required: false, options: ["sm", "md"], type: '"sm" | "md"' }), prop("invalid", { required: false, type: "boolean" })],
      Badge: [prop("label", { required: true, type: "string" })],
    });
  });

  test("a type declared in another file of the library is read when only that file declares it", () => {
    const files = new Map([
      ["src/types.ts", "export type CardProps = { heading: string; elevated?: boolean }\n"],
      ["src/card.tsx", 'import type { CardProps } from "./types"\n\nexport function Card({ heading, elevated = true }: CardProps) {\n  return <section>{heading}</section>\n}\n'],
    ]);
    expect(componentProps(files, ["Card"])).toEqual({
      Card: [prop("heading", { required: true, type: "string" }), prop("elevated", { default: "true", required: false, type: "boolean" })],
    });
  });

  test("a component it can't read, or can't find, has no props", () => {
    const files = new Map([
      ["src/select.tsx", 'import { Select as SelectPrimitive } from "@base-ui/react/select";\nexport const Select = SelectPrimitive.Root;\n'],
      ["src/broken.tsx", "function Broken({ a = ("],
    ]);
    expect(componentProps(files, ["Select", "Broken", "Missing"])).toEqual({ Select: [], Broken: [], Missing: [] });
  });
});

describe("componentUses", () => {
  test("names the catalog components each component renders, by its own part of the file", () => {
    const files = new Map([
      [
        "/lib/meal-card.tsx",
        `import { Badge } from "./badge";
import { Button } from "./button";

export function MealCard({ title, time }: { title: string; time?: string }) {
  return (
    <div>
      <h3>{title}</h3>
      {time !== undefined && <Badge>{time}</Badge>}
      <Button variant="outline">Cook this</Button>
    </div>
  );
}

export function MealList({ children }: { children: React.ReactNode }) {
  return <ul>{children}</ul>;
}
`,
      ],
      ["/lib/button.tsx", `export function Button(props: { children: React.ReactNode }) {\n  return <button {...props} />;\n}\n`],
    ]);
    expect(componentUses(files, ["MealCard", "MealList", "Badge", "Button"])).toEqual({ MealCard: ["Badge", "Button"] });
  });
});
