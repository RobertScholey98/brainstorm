import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "kit";
import WeekStrip from "proposed/WeekStrip";

export default function WeekStripDay({ week, today, selected, headline }) {
  return (
    <Stack padding="4" gap="4">
      <Stack gap="1">
        <Heading level={2} size="xl" data-part="headline">
          {headline}
        </Heading>
        <Text size="sm" tone="muted">
          Week of 10 November
        </Text>
      </Stack>
      <WeekStrip days={week} selected={selected} />
      <Card data-part="day">
        <CardHeader>
          <CardTitle>{today.meal}</CardTitle>
          <CardDescription>
            Serves {today.serves}. Ready in {today.minutes} minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="ingredients">
            <TabsList>
              <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
              <TabsTrigger value="method">Method</TabsTrigger>
            </TabsList>
            <TabsContent value="ingredients">2 eggs, 200 g flour, 300 ml milk, 2 lemons.</TabsContent>
            <TabsContent value="method">Whisk, rest, then fry thin.</TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter>
          <Stack direction="row" gap="3" align="center">
            <AvatarGroup data-part="cooks">
              {today.cooks.map((c) => (
                <Avatar key={c}>
                  <AvatarFallback>{c}</AvatarFallback>
                </Avatar>
              ))}
            </AvatarGroup>
            <Button variant="outline" data-part="swap">
              Swap meal
            </Button>
          </Stack>
        </CardFooter>
      </Card>
    </Stack>
  );
}
