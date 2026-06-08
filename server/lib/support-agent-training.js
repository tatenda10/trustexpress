export const DEFAULT_SUPPORT_AGENT_SYSTEM_PROMPT =
  'You are the Trust Express support assistant. Reply clearly, briefly, and politely using only Trust Express policy and support guidance. If the answer is not fully covered by the training content, say that a human support agent will follow up and ask for the needed trip details. Never invent fees, rules, or promises. Keep replies practical and safe.';

export const DEFAULT_SUPPORT_AGENT_SECTIONS = [
  {
    title: 'Registration and Booking',
    items: [
      ['How do I register on Trust Express?', 'Download the Trust Express application from the Google Play Store or Apple Store, create an account, and complete registration by providing the required information and documents.'],
      ['How do I book a ride?', 'Open the Trust Express app, enter your pickup and destination, choose a vehicle category, and request a ride.'],
      ['What vehicle categories are available on Trust Express?', 'Trust Express offers Trust Express (standard rides), Trust Extra Large (group travel and luggage), and Trust Luxury (premium rides).'],
      ['Which ride should I choose if I have luggage?', 'Passengers travelling with luggage are advised to request Trust Extra Large for enough space and comfort.'],
      ['Which ride should I choose for group travel?', 'Passengers travelling in groups should request Trust Extra Large to ensure enough seating capacity.'],
      ['Can I request a specific driver?', 'No. Drivers are assigned based on availability and system matching.'],
    ],
  },
  {
    title: 'Pricing, Payments, and Tips',
    items: [
      ['Can drivers charge extra money outside the app?', 'No. Drivers are not allowed to request or charge extra money outside the application fare.'],
      ['What should I do if a driver asks me to add $1 or $2 at the end of a trip?', 'Please report the matter immediately to Trust Express Support with trip details for investigation.'],
      ['Can I tip my driver?', 'Yes. Passengers may voluntarily tip drivers using the in-app tip option after a ride.'],
      ['Can drivers force passengers to tip?', 'No. Drivers are not allowed to force or demand tips from passengers.'],
      ['Can I pay outside the app?', 'No. Payments must follow Trust Express policies and approved payment systems.'],
      ['Why is my payment not reflecting?', 'Payment delays may occur because of banking processes, technical delays, or internet issues.'],
      ['How do I update my banking details?', 'Update your banking details through account settings or contact support for assistance.'],
      ['How do I receive card payment trips?', 'Drivers must update banking details in the system to receive card payment trips.'],
    ],
  },
  {
    title: 'Safety and Conduct',
    items: [
      ['What should I do during an emergency trip situation?', 'Use the emergency or panic feature where available and contact emergency services if immediate danger exists.'],
      ['What should I do if I feel unsafe during a trip?', 'Use emergency features where available, contact emergency services if necessary, and report the issue to Trust Express Support.'],
      ['Can someone else use my account?', 'No. Trust Express accounts are personal and must not be shared with others.'],
      ['Can I smoke or drink alcohol during a trip?', 'No. Smoking, alcohol consumption, or inappropriate behaviour during trips is prohibited.'],
      ['Are dangerous weapons allowed during trips?', 'No. Carrying dangerous or prohibited weapons during trips may result in immediate account blocking.'],
      ['What should I do if I leave an item in a vehicle?', 'Contact Trust Express Support immediately with trip details so assistance can be provided.'],
      ['How do I report a driver or passenger?', 'Report the driver or passenger through the support system and provide trip details.'],
    ],
  },
  {
    title: 'Account and Verification',
    items: [
      ['Why can my account be blocked?', 'Accounts may be blocked for violating Trust Express policies such as fraud, misconduct, abusive behaviour, repeated cancellations, unsafe actions, or charging money outside the app.'],
      ['Why was my account blocked?', 'Your account may have been blocked due to policy violations, safety concerns, suspicious activity, or misconduct. Contact support for assistance.'],
      ['How do I appeal a blocked account?', 'Contact Trust Express Support and submit your details for account review.'],
      ['Why is my account under review?', 'Your account may be under review because of complaints, suspicious activity, policy violations, or safety investigations.'],
      ['Why can’t I log into my account?', 'This may happen because of incorrect login details, internet problems, account restrictions, or technical issues.'],
      ['What should I do if I forgot my password?', 'Use the “Forgot Password” option and follow the instructions to reset your password.'],
      ['How do I change my phone number?', 'Update your phone number through account settings or contact support.'],
      ['Why is my account suspended?', 'Accounts may be suspended due to policy violations, repeated complaints, fraud concerns, unsafe behaviour, or misconduct.'],
    ],
  },
  {
    title: 'Driver Operations',
    items: [
      ['What documents are needed for driver registration?', 'Drivers must provide identification documents, a valid driver’s licence, vehicle registration documents, vehicle photos, and any additional required documents.'],
      ['Why was my vehicle rejected?', 'Your vehicle may not meet Trust Express standards for roadworthiness, age requirements, condition, or documentation.'],
      ['What happens if I receive poor ratings?', 'Repeated poor ratings may affect account performance and could result in restrictions or suspension.'],
      ['Why am I not getting trips?', 'Possible reasons include low demand in your area, poor internet connection, account restrictions, being offline, or poor ratings.'],
      ['Why am I getting trip cancellations?', 'Trip cancellations may happen because of delays, location issues, passenger changes, or driver availability.'],
      ['What happens if I cancel too many trips?', 'Repeated cancellations may lead to warnings, temporary restrictions, or account suspension.'],
      ['Can I travel with more passengers than my vehicle category allows?', 'No. Passengers must comply with the seating capacity of the selected vehicle category.'],
      ['How do I update my vehicle details?', 'Drivers can update vehicle details through their profile or support assistance.'],
    ],
  },
  {
    title: 'Trip Issues and Support',
    items: [
      ['How do I contact support?', 'Contact Trust Express Support through the app or official support channels.'],
      ['What should I do if my driver does not arrive?', 'Wait for a reasonable time, try contacting the driver, or contact support for assistance.'],
      ['Why was my trip cancelled?', 'Trips may be cancelled because of driver unavailability, delays, passenger requests, or operational reasons.'],
    ],
  },
];

export function buildDefaultSupportAgentTrainingContent() {
  return DEFAULT_SUPPORT_AGENT_SECTIONS
    .map((section) => {
      const items = section.items
        .map(([question, answer], index) => `${index + 1}. Q: ${question}\nA: ${answer}`)
        .join('\n\n');
      return `${section.title}\n${items}`;
    })
    .join('\n\n---\n\n');
}
