import { getIconPath } from '../../utils/icons';

Component({
  properties: {
    name: {
      type: String,
      value: 'fallback',
    },
    size: {
      type: Number,
      value: 40,
    },
  },

  data: {
    src: getIconPath('fallback'),
  },

  observers: {
    name(name) {
      this.setData({ src: getIconPath(name) });
    },
  },

  lifetimes: {
    attached() {
      this.setData({ src: getIconPath(this.properties.name) });
    },
  },
});
