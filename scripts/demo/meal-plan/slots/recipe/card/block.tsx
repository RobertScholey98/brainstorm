import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Separator,
  Stack,
  Text,
} from "kit";

export default function RecipeCard({ recipe, servings, primary }) {
  return (
    <Stack padding="4">
      <Card data-part="recipe">
        <CardHeader>
          <CardTitle>{recipe.title}</CardTitle>
          <CardDescription>Ready in {recipe.minutes} minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="4">
            <Stack direction="row" gap="2" wrap>
              {recipe.tags.map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
            </Stack>
            <Text size="sm">{recipe.summary}</Text>
            <Separator />
            <Field data-part="servings">
              <FieldLabel htmlFor="servings">Servings</FieldLabel>
              <Input id="servings" type="number" defaultValue={servings} />
              <FieldDescription>Scales the shopping list.</FieldDescription>
            </Field>
          </Stack>
        </CardContent>
        <CardFooter>
          <Stack direction="row" gap="2">
            <Button variant="ghost">Skip</Button>
            <Button data-part="add">{primary}</Button>
          </Stack>
        </CardFooter>
      </Card>
    </Stack>
  );
}
