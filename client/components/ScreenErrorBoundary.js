import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

export default class ScreenErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || 'This screen could not load.',
    };
  }

  componentDidCatch(error, info) {
    console.error('[ScreenErrorBoundary] passenger screen crashed', {
      screen: this.props.screenName || null,
      message: error?.message || String(error),
      stack: error?.stack || null,
      componentStack: info?.componentStack || null,
    });
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#ffffff' }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: '#0f172a' }}>
          Something went wrong
        </Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: '#64748b' }}>
          The passenger screen hit an error. Please try again.
        </Text>
        <Text style={{ marginTop: 8, fontSize: 13, lineHeight: 20, color: '#94a3b8' }}>
          {this.state.message}
        </Text>
        <TouchableOpacity
          onPress={() => {
            this.setState({ hasError: false, message: '' });
            this.props.navigation?.reset?.({
              index: 0,
              routes: [{ name: 'PassengerBookingHome', params: { resetRideDraftAt: Date.now() } }],
            });
          }}
          style={{
            marginTop: 24,
            height: 54,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#206EFF',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '800' }}>
            Back to booking
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
}
