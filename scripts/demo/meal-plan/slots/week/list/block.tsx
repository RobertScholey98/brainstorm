import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Progress,
  ProgressLabel,
  ProgressValue,
  Stack,
} from "kit";

export default function WeekList({ days, shopped, density, showProgress, cta }) {
  return (
    <Stack padding="4" gap="4">
      <Card data-part="week">
        <CardHeader>
          <CardTitle>This week</CardTitle>
          <CardDescription>Four dinners planned, three cooks.</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap={density === "Compact" ? "1" : "3"}>
            {days.map((d) => (
              <Item key={d.day} variant="outline" data-part={`day-${d.day.toLowerCase()}`}>
                <ItemContent>
                  <ItemTitle>
                    {d.day} · {d.meal}
                  </ItemTitle>
                  <ItemDescription>{d.cook} cooks</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant="secondary">{d.tag}</Badge>
                </ItemActions>
              </Item>
            ))}
          </Stack>
        </CardContent>
        {showProgress ? (
          <CardContent>
            <Progress value={shopped} data-part="shopping">
              <ProgressLabel>Shopping list</ProgressLabel>
              <ProgressValue />
            </Progress>
          </CardContent>
        ) : null}
        <CardFooter>
          <Button data-part="cta">{cta}</Button>
        </CardFooter>
      </Card>
    </Stack>
  );
}
