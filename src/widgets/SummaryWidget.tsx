import type { SummaryWidgetProps } from './summaryTypes';

/** Platforms without home-screen widgets (web). Android and iPhone use the .android/.ios files. */
const SummaryWidget = {
  updateSnapshot(_props: SummaryWidgetProps): void {},
};

export default SummaryWidget;
