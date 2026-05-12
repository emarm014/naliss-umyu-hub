import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

interface NalissLogoProps {
  size?: number;
  rounded?: boolean;
}

export const NalissLogo: React.FC<NalissLogoProps> = ({
  size = 200,
  rounded = false,
}) => {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Image
        source={require('../../assets/icon.png')}
        style={[
          styles.logo,
          { width: size, height: size },
          rounded && { borderRadius: size / 2 },
        ]}
        resizeMode="contain"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {},
});
