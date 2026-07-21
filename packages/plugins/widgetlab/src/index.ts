import { BatteryCard } from "./BatteryCard";
import { CalendarCard } from "./CalendarCard";
import { ClockCard } from "./ClockCard";
import { FitnessCard } from "./FitnessCard";
import { PhotosCard } from "./PhotosCard";
import { StocksCard } from "./StocksCard";
import { TodoListCard } from "./TodoListCard";
import { WeatherCard } from "./WeatherCard";

export { widgetlabManifest } from "./manifest";
export { WEATHER_GRADIENT } from "./WeatherCard";

/** defineWidget registers into ICE's module-level catalog as an import side-effect. */
export const widgetlabWidgets = {
  "widgetlab.battery": BatteryCard,
  "widgetlab.calendar": CalendarCard,
  "widgetlab.clock": ClockCard,
  "widgetlab.fitness": FitnessCard,
  "widgetlab.photos": PhotosCard,
  "widgetlab.stocks": StocksCard,
  "widgetlab.todo": TodoListCard,
  "widgetlab.weather": WeatherCard,
};
