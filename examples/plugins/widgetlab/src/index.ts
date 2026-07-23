import { BATTERY_TYPE, BatteryView } from "./BatteryCard";
import { CALENDAR_TYPE, CalendarView } from "./CalendarCard";
import { CLOCK_TYPE, ClockView } from "./ClockCard";
import { CRYSTAL_TYPE, CrystalView } from "./CrystalWidget";
import { FITNESS_TYPE, FitnessView } from "./FitnessCard";
import { CUBE_TYPE, CubeView } from "./FloatingCubeWidget";
import { GOLD_KNOT_CHROME, GOLD_KNOT_TYPE, GoldKnotView } from "./GoldKnotCard";
import { MatteSphereView, SPHERE_CHROME, SPHERE_TYPE } from "./MatteSphereCard";
import {
  FILTER_TYPE,
  FilterNodeView,
  SCOPE_TYPE,
  ScopeNodeView,
  SIGNAL_TYPE,
  SignalNodeView,
} from "./nodes";
import { ORBIT_CUBE_CHROME, ORBIT_CUBE_TYPE, OrbitCubeView } from "./OrbitCubeCard";
import { PHOTOS_TYPE, PhotosView } from "./PhotosCard";
import { SHAPES_CHROME, SHAPES_TYPE, ShapesView } from "./ShapesCard";
import { STOCKS_TYPE, StocksView } from "./StocksCard";
import { TODO_TYPE, TodoListView } from "./TodoListCard";
import { TORUS_KNOT_CHROME, TORUS_KNOT_TYPE, TorusKnotView } from "./TorusKnotCard";
import { WEATHER_TYPE, WeatherView } from "./WeatherCard";

export { widgetlabManifest } from "./manifest";
export { NODE_BG } from "./nodes";
export { WEATHER_GRADIENT } from "./WeatherCard";

/** widget type → the opaque code-side binding the host's builder consumes. */
export const widgetlabBindings = {
  [BATTERY_TYPE]: { component: BatteryView },
  [CALENDAR_TYPE]: { component: CalendarView },
  [CLOCK_TYPE]: { component: ClockView },
  [CRYSTAL_TYPE]: { component: CrystalView, animated: true },
  [CUBE_TYPE]: { component: CubeView, animated: true },
  [FILTER_TYPE]: { component: FilterNodeView },
  [FITNESS_TYPE]: { component: FitnessView },
  [GOLD_KNOT_TYPE]: { component: GoldKnotView, chrome: GOLD_KNOT_CHROME, animated: true },
  [ORBIT_CUBE_TYPE]: { component: OrbitCubeView, chrome: ORBIT_CUBE_CHROME, animated: false },
  [PHOTOS_TYPE]: { component: PhotosView },
  [SCOPE_TYPE]: { component: ScopeNodeView },
  [SHAPES_TYPE]: { component: ShapesView, chrome: SHAPES_CHROME, animated: true },
  [SIGNAL_TYPE]: { component: SignalNodeView },
  [SPHERE_TYPE]: { component: MatteSphereView, chrome: SPHERE_CHROME, animated: false },
  [STOCKS_TYPE]: { component: StocksView },
  [TODO_TYPE]: { component: TodoListView },
  [TORUS_KNOT_TYPE]: { component: TorusKnotView, chrome: TORUS_KNOT_CHROME, animated: true },
  [WEATHER_TYPE]: { component: WeatherView },
};
