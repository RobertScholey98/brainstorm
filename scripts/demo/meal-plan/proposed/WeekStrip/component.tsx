import { Text } from "kit";

export default function WeekStrip({ days, selected }) {
  return (
    <ol className="week-strip" data-part="strip">
      {days.map((d) => (
        <li key={d.day} className="week-day" data-selected={d.day === selected ? "" : undefined}>
          <Text size="xs" tone={d.day === selected ? "default" : "muted"}>
            {d.day}
          </Text>
          <Text size="base" weight="semibold">
            {d.date}
          </Text>
          <span className="week-dot" data-planned={d.planned ? "" : undefined} />
        </li>
      ))}
    </ol>
  );
}
