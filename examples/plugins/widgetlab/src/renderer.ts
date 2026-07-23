import { defineRendererPlugin } from "@vibefield/plugin-sdk";
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

// C1b·2/P3a — the renderer MODULE (spec §10.1): activation binds
// implementations for the manifest's declared types; the host builds the
// durable prefab (§12.2). Top-level code stays pure — everything starts in
// activate. Registration follows the manifest's declared order (clock →
// battery → calendar → weather → stocks → fitness → photos → todo → sphere →
// crystal → torus-knot → cube → gold-knot → shapes → orbit-cube → signal →
// filter → scope).

export default defineRendererPlugin({
  activate(ctx) {
    ctx.widgets.register({ type: CLOCK_TYPE, binding: { component: ClockView } });
    ctx.widgets.register({ type: BATTERY_TYPE, binding: { component: BatteryView } });
    ctx.widgets.register({ type: CALENDAR_TYPE, binding: { component: CalendarView } });
    ctx.widgets.register({ type: WEATHER_TYPE, binding: { component: WeatherView } });
    ctx.widgets.register({ type: STOCKS_TYPE, binding: { component: StocksView } });
    ctx.widgets.register({ type: FITNESS_TYPE, binding: { component: FitnessView } });
    ctx.widgets.register({ type: PHOTOS_TYPE, binding: { component: PhotosView } });
    ctx.widgets.register({ type: TODO_TYPE, binding: { component: TodoListView } });
    ctx.widgets.register({
      type: SPHERE_TYPE,
      binding: { component: MatteSphereView, chrome: SPHERE_CHROME, animated: false },
    });
    ctx.widgets.register({
      type: CRYSTAL_TYPE,
      binding: { component: CrystalView, animated: true },
    });
    ctx.widgets.register({
      type: TORUS_KNOT_TYPE,
      binding: { component: TorusKnotView, chrome: TORUS_KNOT_CHROME, animated: true },
    });
    ctx.widgets.register({ type: CUBE_TYPE, binding: { component: CubeView, animated: true } });
    ctx.widgets.register({
      type: GOLD_KNOT_TYPE,
      binding: { component: GoldKnotView, chrome: GOLD_KNOT_CHROME, animated: true },
    });
    ctx.widgets.register({
      type: SHAPES_TYPE,
      binding: { component: ShapesView, chrome: SHAPES_CHROME, animated: true },
    });
    ctx.widgets.register({
      type: ORBIT_CUBE_TYPE,
      binding: { component: OrbitCubeView, chrome: ORBIT_CUBE_CHROME, animated: false },
    });
    ctx.widgets.register({ type: SIGNAL_TYPE, binding: { component: SignalNodeView } });
    ctx.widgets.register({ type: FILTER_TYPE, binding: { component: FilterNodeView } });
    ctx.widgets.register({ type: SCOPE_TYPE, binding: { component: ScopeNodeView } });
  },
});
