import { BatteryCard } from "./BatteryCard";
import { CalendarCard } from "./CalendarCard";
import { ClockCard } from "./ClockCard";
import { CrystalWidget } from "./CrystalWidget";
import { FitnessCard } from "./FitnessCard";
import { FloatingCubeWidget } from "./FloatingCubeWidget";
import { GoldKnotCard } from "./GoldKnotCard";
import { MatteSphereCard } from "./MatteSphereCard";
import { FilterNode, ScopeNode, SignalNode } from "./nodes";
import { OrbitCubeCard } from "./OrbitCubeCard";
import { PhotosCard } from "./PhotosCard";
import { ShapesCard } from "./ShapesCard";
import { StocksCard } from "./StocksCard";
import { TodoListCard } from "./TodoListCard";
import { TorusKnotCard } from "./TorusKnotCard";
import { WeatherCard } from "./WeatherCard";

export { widgetlabManifest } from "./manifest";
export { NODE_BG } from "./nodes";
export { WEATHER_GRADIENT } from "./WeatherCard";

/** defineWidget registers into ICE's module-level catalog as an import side-effect. */
export const widgetlabWidgets = {
  "widgetlab.battery": BatteryCard,
  "widgetlab.calendar": CalendarCard,
  "widgetlab.clock": ClockCard,
  "widgetlab.crystal": CrystalWidget,
  "widgetlab.cube": FloatingCubeWidget,
  "widgetlab.filter": FilterNode,
  "widgetlab.fitness": FitnessCard,
  "widgetlab.gold-knot": GoldKnotCard,
  "widgetlab.orbit-cube": OrbitCubeCard,
  "widgetlab.photos": PhotosCard,
  "widgetlab.scope": ScopeNode,
  "widgetlab.shapes": ShapesCard,
  "widgetlab.signal": SignalNode,
  "widgetlab.sphere": MatteSphereCard,
  "widgetlab.stocks": StocksCard,
  "widgetlab.todo": TodoListCard,
  "widgetlab.torus-knot": TorusKnotCard,
  "widgetlab.weather": WeatherCard,
};
