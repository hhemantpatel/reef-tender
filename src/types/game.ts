export type ModalType = 'projects' | 'skills' | 'experience' | 'contact' | 'about' | 'bed' | 'badminton' | 'recruiter' | null;

export interface GameContextType {
  activeModal: ModalType;
  openModal: (type: ModalType) => void;
  closeModal: () => void;
  hasStarted: boolean;
  startGame: () => void;
  isInsideHouse: boolean;
  setIsInsideHouse: (inside: boolean) => void;
  isMuted: boolean;
  toggleMute: () => void;
  unlockAudio: () => void;
  nearbyZone: string | null;
  setNearbyZone: (zone: string | null) => void;
  // Reset / Teleport actions
  teleportTarget: 'spawn' | 'desk' | null;
  triggerTeleport: (target: 'spawn' | 'desk') => void;
  clearTeleport: () => void;
}
