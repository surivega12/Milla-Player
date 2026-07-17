import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { playbackService } from './services/playback-service';

registerRootComponent(App);
if (Platform.OS !== 'web') {
  TrackPlayer.registerPlaybackService(() => playbackService);
}
