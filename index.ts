import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import TrackPlayer from './services/player-engine';
import App from './App';
import { playbackService } from './services/playback-service';

registerRootComponent(App);
if (Platform.OS !== 'web') {
  TrackPlayer.registerPlaybackService(() => playbackService);
}
