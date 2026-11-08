import { Card, CardBody, CardTitle } from "./Card";

export default { title: "Layout/Card", component: Card };

export const Basic = {
  render: () => (
    <Card>
      <CardTitle>Chores</CardTitle>
      <CardBody>Three left this week.</CardBody>
    </Card>
  ),
};
