import { MealCard } from "@/components/meal/meal-card";
import { session } from "./store";

export function App() {
  return <MealCard title={`Hello ${session.user}`} time="20 min" />;
}
