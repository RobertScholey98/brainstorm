import Badge from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function MealCard({ title, time }: { title: string; time: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-border bg-background p-4 text-foreground">
      <h3 className="text-base font-medium">{title}</h3>
      <Badge>{time}</Badge>
      <Button variant="outline">Cook this</Button>
    </div>
  );
}
