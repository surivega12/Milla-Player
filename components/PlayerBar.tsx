import React from 'react';
import { MiniPlayer, MiniPlayerProps, Track as MiniPlayerTrack } from './MiniPlayer';

export type Track = MiniPlayerTrack;
export type PlayerBarProps = MiniPlayerProps;

export const PlayerBar: React.FC<PlayerBarProps> = (props) => {
  return <MiniPlayer {...props} />;
};
