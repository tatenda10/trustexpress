import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PRIVACY_POLICY = {
  title: 'Privacy Policy',
  updatedAt: 'Last updated: 31/03/2026',
  sections: [
    {
      heading: '1. Introduction',
      body: [
        'Welcome to Trust Express App. We respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, and safeguard your information when you use our e-hailing and ride services platform.',
      ],
    },
    {
      heading: '2. Information We Collect',
      body: [
        'We collect personal information that you provide to us when you register for an account with National ID verification, book a ride, use in-app wallet and payment services, or contact us for customer support.',
        'This information may include your National ID number, full legal name, customer photo (selfie), email address, phone number, address, payment information, and ride history records.',
      ],
    },
    {
      heading: '3. How We Use Your Information',
      body: [
        'We use the information we collect to process and manage your ride bookings, verify your identity using National ID, enable GPS tracking during rides for safety, process payments and manage wallet transactions, communicate with you about your rides, send you important updates and notifications, improve our services and user experience, comply with legal obligations, and prevent fraud and ensure security.',
      ],
    },
    {
      heading: '4. Data Security',
      body: [
        'We implement appropriate technical and organizational security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.',
      ],
    },
    {
      heading: '5. Data Sharing',
      body: [
        'We do not sell, trade, or rent your personal information to third parties. We may share your information only with service providers who assist us in operating our business, when required by law or to respond to legal processes, to protect our rights, property, or safety, or with your explicit consent.',
      ],
    },
    {
      heading: '6. Your Rights',
      body: [
        'You have the right to access your personal information, correct inaccurate or incomplete data, request deletion of your personal information, object to processing of your personal information, and withdraw consent at any time.',
      ],
    },
    {
      heading: '7. Cookies',
      body: [
        'We use cookies and similar tracking technologies to enhance your experience on our website. You can control cookie preferences through your browser settings.',
      ],
    },
    {
      heading: '8. Contact Us',
      body: [
        'If you have any questions about this Privacy Policy, please contact us at:',
        'Email: info@trustexpress.co.zw',
        'Phone: 0773975318',
        'Address: Flat 107 Roma Court corner Harare Street and Fife Avenue',
      ],
    },
  ],
};

const TERMS_OF_USE = {
  title: 'Terms of Use',
  updatedAt: 'Last updated: 31/03/2026',
  sections: [
    {
      heading: '1. Acceptance of Terms',
      body: [
        'By creating an account or using Trust Express, you agree to follow these Terms of Use and any policies referenced in the app.',
      ],
    },
    {
      heading: '2. Account Responsibility',
      body: [
        'You are responsible for keeping your account information accurate, keeping your login credentials secure, and using the app only for lawful purposes. You must not impersonate another person or submit false information or documents.',
      ],
    },
    {
      heading: '3. Identity And Verification',
      body: [
        'Trust Express may require phone verification, National ID verification, selfies, vehicle documentation, and other supporting information before certain features are enabled. Drivers and passengers must provide truthful and valid documents when requested.',
      ],
    },
    {
      heading: '4. Ride Use And Conduct',
      body: [
        'Passengers and drivers must use the platform respectfully and safely. Harassment, threats, fraud, misuse of payments, abuse of support channels, or any unlawful conduct may lead to suspension, blocking, or account closure.',
      ],
    },
    {
      heading: '5. Payments, Wallets And Charges',
      body: [
        'Ride fares, wallet transactions, applicable fees, and adjustments shown in the app form part of your use of the service. You are responsible for reviewing trip and payment information before confirming transactions where applicable.',
      ],
    },
    {
      heading: '6. Cancellations, Suspensions And Closures',
      body: [
        'Trust Express may suspend, restrict, reject, or close accounts where verification is incomplete, where documents are rejected, where safety concerns arise, or where there is suspected fraud, misuse, or legal risk.',
      ],
    },
    {
      heading: '7. Availability Of Service',
      body: [
        'We work to keep the platform available and reliable, but we do not guarantee uninterrupted service at all times. Network issues, maintenance, third-party outages, and force majeure events may affect availability.',
      ],
    },
    {
      heading: '8. Liability And Legal Compliance',
      body: [
        'Trust Express operates the platform and may investigate incidents, preserve records where required, and cooperate with lawful requests. To the extent permitted by law, our liability is limited to the proper operation of the service and applicable legal obligations.',
      ],
    },
    {
      heading: '9. Contact Us',
      body: [
        'If you have questions about these Terms of Use, please contact us at info@trustexpress.co.zw or 0773975318.',
      ],
    },
  ],
};

const DOCUMENTS = {
  privacy: PRIVACY_POLICY,
  terms: TERMS_OF_USE,
};

export default function LegalDocumentScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const documentKey = route.params?.document === 'terms' ? 'terms' : 'privacy';
  const document = DOCUMENTS[documentKey];

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation.goBack()}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">{document.title}</Text>
        <View className="h-10 w-10" />
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
      >
        <View className="rounded-[28px] bg-white px-5 py-5">
          <Text className="text-[24px] font-bold text-gray-950">{document.title}</Text>
          <Text className="mt-2 text-sm font-medium text-gray-500">{document.updatedAt}</Text>

          {document.sections.map((section) => (
            <View key={section.heading} className="mt-6">
              <Text className="text-[16px] font-semibold text-gray-900">{section.heading}</Text>
              {section.body.map((paragraph, index) => (
                <Text key={`${section.heading}-${index}`} className="mt-3 text-[15px] leading-6 text-gray-600">
                  {paragraph}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
