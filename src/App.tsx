import React, { Suspense, lazy } from 'react';
import { GameProvider } from './context/GameContext';
import { GardenProvider } from './context/GardenContext';
import { HUD } from './components/ui/HUD';
import { StartScreen } from './components/ui/StartScreen';
import { Modals } from './components/ui/Modals';
import { MobileControls } from './components/ui/MobileControls';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// three.js + the scene are the bulk of the bundle: load them after the UI shell paints
const GameCanvas = lazy(() => import('./components/game/GameCanvas').then((m) => ({ default: m.GameCanvas })));

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <GameProvider>
        <GardenProvider>
          <div className="relative w-screen h-screen overflow-hidden bg-gradient-to-b from-[#475e8a] via-[#e67a5c] to-[#ffb36b] font-game">
            {/* 3D World Viewport */}
            <Suspense fallback={null}>
              <GameCanvas />
            </Suspense>

            {/* UI Overlay Systems */}
            <StartScreen />
            <HUD />
            <Modals />
            <MobileControls />
          </div>
        </GardenProvider>
      </GameProvider>
    </ErrorBoundary>
  );
};

export default App;
