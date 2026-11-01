import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PumpkinScene } from "./src/scene/PumpkinScene";

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#141a33" }}>
      <StatusBar style="light" hidden />
      <PumpkinScene />
    </GestureHandlerRootView>
  );
}
