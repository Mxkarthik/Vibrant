
const Event = require("./models/Event");

const testEvent = async (name, eventData) => {
    try {
        const event = new Event(eventData);

        await event.validate();

        console.log(`✅ ${name}: PASSED`);
    } catch (error) {
        console.log(`❌ ${name}: REJECTED`);
        console.log(error.message);
    }
};

const validEvent = {
    name: "VIBRANT AI Hackathon",
    description: "A 24-hour AI hackathon",
    category: "TECHNICAL",
    venue: "College Auditorium",

    startDate: new Date("2027-01-20T09:00:00"),
    endDate: new Date("2027-01-21T09:00:00"),

    registration: {
        mode: "TEAM",
        deadline: new Date("2027-01-15T23:59:00"),
        capacity: 100,
        registeredParticipants: 0,
        registrationFee: 100,
        minTeamSize: 2,
        maxTeamSize: 5
    },

    createdBy: "672abc123456789012345678"
};

const runTests = async () => {

    // Test 1: Valid event
    await testEvent("Valid team event", validEvent);

    // Test 2: End date before start date
    await testEvent("Invalid event dates", {
        ...validEvent,
        endDate: new Date("2027-01-19T09:00:00")
    });

    // Test 3: Minimum team size greater than maximum
    await testEvent("Invalid team size", {
        ...validEvent,
        registration: {
            ...validEvent.registration,
            minTeamSize: 6,
            maxTeamSize: 4
        }
    });

    // Test 4: Capacity smaller than minimum team size
    await testEvent("Insufficient capacity", {
        ...validEvent,
        registration: {
            ...validEvent.registration,
            capacity: 1
        }
    });
};

runTests();
