import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { playbackService } from './services/playback-service';

registerRootComponent(App);
TrackPlayer.registerPlaybackService(() => playbackService);
